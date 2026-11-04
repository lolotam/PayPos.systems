import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { ORDER_IDS, seedOrders } from './orders-fixture.ts';
import { createTestDatabase } from './test-database.ts';
import { seedTwoTenants, TENANT, USER } from './tenancy-fixtures.ts';

export type Tenant = { company: string; business: string; branch: string };
export type Sale = ReturnType<typeof saleIds>;
const saleIds = (tenant: Tenant, value: string) => ({ tenant, value, entitlement: randomUUID(), component: randomUUID(), slot: randomUUID(), redemption: randomUUID(), line: randomUUID(), session: randomUUID() });

/** نسخة ADR0006 واحدة لكل spec؛ تجهيز البيانات بدور المالك والاختبارات بدور التطبيق. */
export async function redemptionFixture() {
  const testDb = await createTestDatabase();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  const app = postgres(testDb.appUrl, { max: 2, onnotice: () => undefined });
  await seedTwoTenants(testDb.ownerUrl);
  await seedOrders(owner);
  const packageType = randomUUID();
  for (const t of Object.values(TENANT)) await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${t.company},${packageType},${t.business},'Synthetic package',1.000,30)`;
  return {
    owner, app, testDb,
    async asApp<T>(work: (tx: postgres.TransactionSql) => Promise<T>, tenant: Tenant = TENANT.A) {
      return app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id',${tenant.company},true), set_config('app.user_id',${USER},true)`;
        return work(tx);
      });
    },
    async sale(tx: postgres.TransactionSql, tenant: Tenant = TENANT.A, value = '1.000') {
      const s = saleIds(tenant, value);
      await tx`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,
        list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,sold_business_date,sold_timezone,
        recorded_by,recorded_by_membership_id,expires_on,refunded_amount,revision)
        VALUES(${tenant.company},${s.entitlement},${tenant.business},${ORDER_IDS.customer},${packageType},'SOLD','Synthetic package',30,
        ${value},${value},0,0,'CASH',${ORDER_IDS.employee},${tenant.branch},now(),current_date,'Asia/Kuwait',${USER},${ORDER_IDS.membership},current_date+30,0,1)`;
      await tx`INSERT INTO package_components(company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
        VALUES(${tenant.company},${s.component},${tenant.business},${s.entitlement},${ORDER_IDS.service},1,'Synthetic service',${value},1,${value})`;
      await tx`INSERT INTO package_session_slots(company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
        VALUES(${tenant.company},${s.slot},${tenant.business},${s.entitlement},${s.component},1,${value},'FREE')`;
      return s;
    },
    async close() { await app.end(); await owner.end(); await testDb.drop(); },
  };
}
export type RedemptionFixture = Awaited<ReturnType<typeof redemptionFixture>>;

/** ينسخ fixture المدفوع مع مال الـslot وعلامته؛ overrides لصناعة حالات الرفض فقط. */
export async function insertRedemptionLine(tx: postgres.TransactionSql, s: Sale, overrides: Record<string, unknown> = {}, visit: Record<string, unknown> = {}) {
  const t = s.tenant;
  await tx`INSERT INTO service_sessions SELECT (jsonb_populate_record(NULL::service_sessions,to_jsonb(v)||
    ${tx.json({ id:s.session,...visit })}::jsonb)).* FROM service_sessions v WHERE company_id=${t.company} AND id=${ORDER_IDS.session}`;
  const fields = { id: s.line, session_id: s.session, redemption_id: s.redemption,
    list_price: s.value, price: s.value, net: s.value, ...overrides };
  await tx`INSERT INTO service_lines SELECT (jsonb_populate_record(NULL::service_lines,to_jsonb(l)||${tx.json(fields)}::jsonb)).*
    FROM service_lines l WHERE company_id=${t.company} AND id=${ORDER_IDS.line}`;
  await tx`INSERT INTO line_performers SELECT (jsonb_populate_record(NULL::line_performers,to_jsonb(p)||
    jsonb_build_object('id',${randomUUID()}::text,'line_id',${s.line}::text))).*
    FROM line_performers p WHERE company_id=${t.company} AND id=${ORDER_IDS.performer}`;
}

/** إدخال طرف التاريخ منفصل لإثبات ترتيبات الكتابة المؤجلة. */
export async function insertRedemption(tx: postgres.TransactionSql, s: Sale, overrides: Record<string, unknown> = {}) {
  const row = { company_id: s.tenant.company, id: s.redemption, business_id: s.tenant.business,
    entitlement_id: s.entitlement, component_id: s.component, slot_id: s.slot, line_id: s.line,
    redeemed_at: '2026-11-05T00:00:00.000Z', recorded_by: USER, recorded_by_membership_id: ORDER_IDS.membership,
    ...overrides };
  await tx`INSERT INTO package_redemptions SELECT (jsonb_populate_record(NULL::package_redemptions,${tx.json(row)}::jsonb)).*`;
}

/** حجز slot داخل معاملة الاسترداد نفسها. */
export async function claimSlot(tx: postgres.TransactionSql, s: Sale) {
  await tx`UPDATE package_session_slots SET state='USED',current_redemption_id=${s.redemption}
    WHERE company_id=${s.tenant.company} AND id=${s.slot}`;
}

/** الربط الكامل كما سيفعله الكاتب المستقبلي؛ ليس تفعيلًا لمسار التطبيق. */
export async function redeem(tx: postgres.TransactionSql, s: Sale) {
  await insertRedemptionLine(tx,s); await insertRedemption(tx,s); await claimSlot(tx,s);
}

/** دليل إلغاء 054 منفصل لإثبات رفض الإلغاء الذي لم يعكس الاسترداد. */
export async function cancelRedemptionLine(tx: postgres.TransactionSql, s: Sale, cancellation = randomUUID()) {
  await tx`UPDATE service_lines SET status='CANCELLED',revision=revision+1 WHERE company_id=${s.tenant.company} AND id=${s.line}`;
  await tx`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,previous_price,previous_discount,previous_net,
    cancelled_by,cancelled_by_membership_id,cancelled_at,reason,canceller_name_en)
    SELECT company_id,${cancellation},business_id,id,revision,revision-1,price,discount,net,${USER},${ORDER_IDS.membership},now(),'Synthetic reversal','Synthetic recorder'
    FROM service_lines WHERE company_id=${s.tenant.company} AND id=${s.line}`;
  return cancellation;
}

/** إلغاء 054 وعكسه وتحرير الرصيد في معاملة واحدة. */
export async function reverse(tx: postgres.TransactionSql, s: Sale) {
  const cancellation = await cancelRedemptionLine(tx,s);
  await tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${cancellation}
    WHERE company_id=${s.tenant.company} AND id=${s.redemption}`;
  await tx`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL WHERE company_id=${s.tenant.company} AND id=${s.slot}`;
  return cancellation;
}
