import { AT, ids, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { seedPackage, type PackageSeed } from './package-redemption.fixture.ts';

export const CURRENT_EXPIRY = '2026-12-30';
export const NEXT_EXPIRY = '2027-01-31';

/** seedPackage يسمي نوع الباقة باسم ثابت؛ نغيّر القديم قبل كل بيع حتى لا يصطدم بقيد الاسم الفريد. */
export async function seedSoldPackage(
  f: SessionFixture,
  options: { sessions: number; expiresOn: string },
): Promise<PackageSeed> {
  await f.h.owner`UPDATE package_types SET name_en = name_en || ' ' || id::text
    WHERE company_id = ${f.company} AND name_en = 'Synthetic package type'`;
  return seedPackage(f, { ...options, soldAt: new Date('2026-10-01T08:00:00.000Z') });
}

export interface PackageExtensionFixture {
  f: SessionFixture;
  sold: PackageSeed;
  setAt(next: Date): void;
}

export async function packageExtensionFixture(): Promise<PackageExtensionFixture> {
  let at = AT;
  const clock = { now: () => at };
  const f = await sessionFixture({ ordersClock: clock });
  try {
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
      VALUES(${f.company},${ids.newId()},${f.membership},'extend:packages:branch','ALLOW','BRANCH',${f.branch},
        NULL,'Synthetic extension grant',${f.ownerId})`;
    const sold = await seedSoldPackage(f, { sessions: 2, expiresOn: CURRENT_EXPIRY });
    return {
      f,
      sold,
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

export function extensionBody(overrides: Record<string, unknown> = {}) {
  return {
    new_expires_on: NEXT_EXPIRY,
    expected_expires_on: CURRENT_EXPIRY,
    reason: 'Customer requested more time',
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

export function extensionPath(
  f: SessionFixture,
  entitlementId: string,
  businessId = f.business,
  branchId = f.branch,
): string {
  return `/v1/businesses/${businessId}/branches/${branchId}/packages/${entitlementId}/extensions`;
}

export async function postExtension(
  f: SessionFixture,
  entitlementId: string,
  options: RequestOptions = {},
) {
  return f.h.send('POST', extensionPath(f, entitlementId, options.businessId, options.branchId), {
    cookie: options.cookie ?? f.cookie,
    company: options.company ?? f.company,
    key: options.key ?? ids.newId(),
    body: options.body ?? extensionBody(),
  });
}

export async function readEntitlement(f: SessionFixture, entitlementId: string) {
  const [row] = await f.h.owner`SELECT expires_on::text AS expires_on,refunded_amount::text AS refunded_amount,
    revision,price_paid::text AS price_paid,provenance FROM package_entitlements WHERE id=${entitlementId}`;
  return row;
}

export async function readSlots(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT ordinal,state,unit_value::text AS unit_value,current_redemption_id
    FROM package_session_slots WHERE entitlement_id=${entitlementId} ORDER BY ordinal`;
}

export async function readExtensions(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT id,previous_expires_on::text AS previous_expires_on,new_expires_on::text AS new_expires_on,
    reason,extended_by,extended_by_membership_id,branch_id,extended_at::text AS extended_at
    FROM package_extensions WHERE entitlement_id=${entitlementId} ORDER BY extended_at,id`;
}

export async function readExtensionAudits(f: SessionFixture, entitlementId: string) {
  return f.h.owner`SELECT action,entity,entity_id,before,after,actor_user_id FROM audit_log
    WHERE entity_id=${entitlementId} AND action='package.extended' ORDER BY id`;
}

export async function seedSecondBusinessPackage(f: SessionFixture): Promise<PackageSeed> {
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
    branch: f.foreignBranch,
    customer,
    services: [serviceId],
    membership: membership?.['id'] as string,
  };
  return seedPackage(foreign, { sessions: 1, expiresOn: CURRENT_EXPIRY });
}
