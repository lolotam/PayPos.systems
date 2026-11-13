import { SYSTEM_ROLES } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { seedPackage, type PackageSeed } from './package-redemption.fixture.ts';

export const CURRENT_EXPIRY = '2026-12-30';
export const EXPIRED_EXPIRY = '2026-10-14';
export const UNIT = '2.250';

/** بيع كامل؛ seedPackage يسمي نوع الباقة باسم ثابت، فبنغيّر القديم قبل كل بيع. */
export async function seedSoldPackage(
  f: SessionFixture,
  options: { sessions?: number; expiresOn?: string; unit?: string } = {},
): Promise<PackageSeed> {
  await renameSyntheticPackageTypes(f);
  return seedPackage(f, {
    sessions: options.sessions ?? 10,
    expiresOn: options.expiresOn ?? CURRENT_EXPIRY,
    unit: options.unit ?? UNIT,
    soldAt: new Date('2026-10-01T08:00:00.000Z'),
  });
}

/** أسماء أنواع الباقات التركيبية ثابتة، فبنلفّها قبل كل بيع جديد. */
async function renameSyntheticPackageTypes(f: SessionFixture): Promise<void> {
  await f.h.owner`UPDATE package_types SET name_en = name_en || ' ' || id::text
    WHERE company_id = ${f.company} AND name_en IN ('Synthetic package type','Synthetic refund package type')`;
}

export interface PackageRefundFixture {
  f: SessionFixture;
  sold: PackageSeed;
  imported: PackageSeed;
  manager: string;
  outsider: string;
  deviceToken: string;
  setAt(next: Date): void;
}

/** فريق فيه عضو بالصلاحية وعضو من غيرها وجهاز مسجّل. */
export async function packageRefundFixture(): Promise<PackageRefundFixture> {
  let at = AT;
  const clock = { now: () => at };
  const f = await sessionFixture({ ordersClock: clock });
  try {
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
      VALUES(${f.company},${ids.newId()},${f.membership},'refund:packages:branch','ALLOW','BRANCH',${f.branch},
        NULL,'Synthetic refund grant',${f.ownerId})`;
    const outsiderCookie = await f.h.signedInOperator('no-package-refund@example.test');
    const [outsider] = await f.h.owner`SELECT id FROM "user" WHERE email='no-package-refund@example.test'`;
    const cashier = must(SYSTEM_ROLES.find((role) => role.code === 'cashier')).id;
    await f.h.owner`INSERT INTO memberships
      (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
      VALUES(${f.company},${ids.newId()},${outsider?.['id']},${cashier},'global','BRANCH',${f.branch},'2026-01-01')`;
    const sold = await seedSoldPackage(f);
    const imported = await seedPackage(f, {
      sessions: 10,
      expiresOn: CURRENT_EXPIRY,
      unit: UNIT,
    });
    return {
      f,
      sold,
      imported,
      manager: f.cookie,
      outsider: outsiderCookie,
      deviceToken: await approvedDeviceToken(f),
      setAt(next: Date) {
        at = next;
        f.setAt(next);
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

/** جهاز حقيقي مسجّل ومقبول: الـ route لازم يرفضه زي أي مبدأ مش مستخدم. */
export async function approvedDeviceToken(f: SessionFixture): Promise<string> {
  const pairing = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expect(pairing.status).toBe(201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: pairing.body['code'], label: 'Synthetic refund till' },
  });
  expect(registered.statusCode).toBe(201);
  const regJson = registered.json() as { device_id: string; claim_secret: string };
  const approved = await f.h.send(
    'POST',
    `/v1/branches/${f.branch}/devices/${regJson.device_id}/approve`,
    { cookie: f.ownerCookie, company: f.company },
  );
  expect(approved.status).toBe(204);
  const claimed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: {
      company_id: f.company,
      device_id: regJson.device_id,
      claim_secret: regJson.claim_secret,
    },
  });
  expect(claimed.statusCode).toBe(200);
  return must((claimed.json() as { device_token: string }).device_token);
}

/** باقة بمكوّنين: كل استرداد في ملف تاني بيمسك مكوّن من اتنين. المكوّنات كل واحد على خدمة (قيد الاستحقاق والخدمة). */
export async function seedTwoComponentPackage(
  f: SessionFixture,
  options: { sessions?: number; unit?: string } = {},
): Promise<{ entitlement: string; components: string[] }> {
  await renameSyntheticPackageTypes(f);
  const sessions = options.sessions ?? 2;
  const unit = options.unit ?? UNIT;
  const price = moneyToString(BigInt(sessions) * 2n * BigInt(unit.replace('.', '')));
  const entitlement = ids.newId();
  const components = [ids.newId(), ids.newId()];
  const type = ids.newId();
  await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${f.company},${type},${f.business},'Synthetic refund package type',${price},30)`;
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on)
      VALUES(${f.company},${entitlement},${f.business},${f.customer},${type},'SOLD','Synthetic package',30,
        ${price},${price},0,0,'CASH',${must(f.employees[0])},${f.branch},
        ${'2026-10-01T08:00:00.000Z'}::timestamptz,'2026-10-20','Asia/Kuwait',${f.userId},${f.membership},
        ${CURRENT_EXPIRY})`);
    for (const [position, component] of components.entries()) {
      await tx.execute(sql`INSERT INTO package_components
        (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,
          sessions_total,component_value)
        VALUES(${f.company},${component},${f.business},${entitlement},${must(f.services[position])},${position + 1},
          'Synthetic component',${unit},${sessions},${moneyToString(
            BigInt(sessions) * BigInt(unit.replace('.', '')),
          )})`);
    }
    // الجلسات بتدخل بعد كل المكوّنات: التركيب بيتقفل أول ما جلسة واحدة تتسجّل.
    for (const component of components) {
      await tx.execute(sql`INSERT INTO package_session_slots
        (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
        SELECT ${f.company}::uuid, gen_random_uuid(), ${f.business}::uuid, ${entitlement}::uuid,
          ${component}::uuid, n, ${unit}::numeric, 'FREE' FROM generate_series(1, ${sessions}) n`);
    }
  });
  return { entitlement, components };
}

/** باقة في نشاط تاني في نفس الشركة: الطلب ما يشوفهاش. */
export async function seedOtherBusinessPackage(f: SessionFixture): Promise<PackageSeed> {
  const serviceId = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${serviceId},${f.secondBusiness},'Other business service',1.000,'ZERO')`;
  return seedPackage(f, {
    sessions: 1,
    expiresOn: CURRENT_EXPIRY,
    businessId: f.secondBusiness,
    serviceId,
  });
}

/** باقة في شركة تانية: الرد لازم يكون زي المجهول بالظبط. */
export async function seedForeignCompanyPackage(f: SessionFixture): Promise<PackageSeed> {
  const customer = ids.newId();
  const serviceId = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.otherCompany},${customer},'Foreign customer','+999999998999','en',now(),now())`;
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.otherCompany},${serviceId},${f.foreignBusiness},'Foreign service',1.000,'ZERO')`;
  const [membership] = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${f.otherCompany} AND user_id=${f.userId} AND scope_type='COMPANY'`;
  const foreign = {
    ...f,
    company: f.otherCompany,
    business: f.foreignBusiness,
    customer,
    services: [serviceId],
    membership: membership?.['id'] as string,
  };
  return seedPackage(foreign, { sessions: 1, expiresOn: CURRENT_EXPIRY });
}

export function refundBody(overrides: Record<string, unknown> = {}) {
  return {
    component_id: '',
    sessions: 1,
    method: 'CASH',
    reason: 'Customer asked for a refund',
    ...overrides,
  };
}

interface RequestOptions {
  body?: Record<string, unknown>;
  cookie?: string;
  company?: string;
  key?: string;
  businessId?: string;
  branchId?: string;
}

export function refundPath(
  f: SessionFixture,
  entitlementId: string,
  businessId = f.business,
  branchId = f.branch,
): string {
  return `/v1/businesses/${businessId}/branches/${branchId}/packages/${entitlementId}/refunds`;
}

export async function postRefund(
  f: SessionFixture,
  entitlementId: string,
  options: RequestOptions = {},
) {
  return f.h.send('POST', refundPath(f, entitlementId, options.businessId, options.branchId), {
    cookie: options.cookie ?? f.cookie,
    company: options.company ?? f.company,
    key: options.key ?? ids.newId(),
    body: options.body ?? refundBody(),
  });
}

export async function readRefunds(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT id,component_id,sessions,amount::text AS amount,method,reason,entitlement_revision,
    refunded_by,refunded_by_membership_id,branch_id FROM package_refunds WHERE entitlement_id=${entitlementId}
    ORDER BY refunded_at,id`;
}

export async function readRefundSlots(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT rs.ordinal, rs.unit_value::text AS unit_value, s.state
    FROM package_refund_slots rs JOIN package_session_slots s
      ON s.company_id=rs.company_id AND s.id=rs.slot_id
    WHERE rs.entitlement_id=${entitlementId} ORDER BY rs.ordinal`;
}

export async function readRefundAudits(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT action,entity,entity_id,before,after,actor_user_id FROM audit_log
    WHERE entity_id=${entitlementId} AND action='package.refunded' ORDER BY id`;
}

export async function readSaleEvents(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT event_type,payload FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${entitlementId} AND event_type='PackageSaleChanged'
    ORDER BY id`;
}

/** مفتاح استرداد الباقات المستوردة: null يعني مقفول. */
export async function setImportedRefunds(f: SessionFixture, enabled: boolean | null): Promise<void> {
  await f.h.owner`INSERT INTO business_settings(company_id,business_id,imported_refunds_enabled,updated_by,updated_at)
    VALUES(${f.company},${f.business},${enabled},${f.ownerId},now())
    ON CONFLICT (company_id,business_id) DO UPDATE
      SET imported_refunds_enabled=${enabled},updated_by=${f.ownerId},updated_at=now()`;
}

export async function clearImportedRefunds(f: SessionFixture): Promise<void> {
  await f.h.owner`DELETE FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;
}
