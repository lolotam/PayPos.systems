import postgres from 'postgres';
import {
  appendOutboxEvent,
  createDatabase,
  createOutboxDispatcherDatabase,
  SYSTEM_ROLES,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
} from '@pospay/db';
import { packageRefundRecorded } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { ORDER_IDS, seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createPackageRefundNoticeConsumer } from '../index.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';

/** لحظة الاسترداد الثابتة؛ اليوم التقويمي للجرس بيتحسب منها. */
export const REFUNDED_AT = '2026-11-20T09:00:00.000Z';
export const REFUND_BUSINESS_DATE = '2026-11-20';
export const REFUND_AMOUNT = '2.250';
const PACKAGE_PRICE = '4.500';
/** سبب الاسترداد؛ الجرس ما يوصلوش له أبدًا. */
export const REFUND_REASON = 'Synthetic refund reason the bell must never carry';
/** المسترد هو مدير الفرع نفسه، فالجرس لازم يوصله. */
export const REFUNDER_USER = '01920000-0000-7000-8000-0000000000f2';
const PACKAGE_TYPE_ID = '01920000-0000-7000-8000-00000000f501';

export interface SeededRefund {
  readonly entitlement: string;
  readonly component: string;
  readonly refund: string;
  readonly event: ClaimedEvent;
}

export interface RefundNoticeFixture {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly ids: { newId(): string };
  readonly at: Date;
  readonly db: Database;
  readonly owner: postgres.Sql;
  readonly consumer: { id: string; eventTypes: readonly string[] };
  readonly deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  readonly refund: () => Promise<SeededRefund>;
  readonly notices: (refundId: string) => Promise<readonly postgres.Row[]>;
  readonly requests: (entitlementId: string) => Promise<readonly postgres.Row[]>;
  readonly close: () => Promise<void>;
}

/** باقة مباعة فيها استرداد واحد لجلسة واحدة؛ الاسترداد هو مصدر الجرس. */
export async function packageRefundNoticeFixture(): Promise<RefundNoticeFixture> {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
  await seedOrders(owner);
  const ids = systemUuidV7();
  const at = new Date('2026-11-20T09:00:00.000Z');
  await owner`UPDATE memberships SET starts_at=${new Date('2026-01-01T00:00:00.000Z')} WHERE user_id=${USER}`;
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${TENANT.A.company},${PACKAGE_TYPE_ID},${TENANT.A.business},'Synthetic package',4.500,30)`;
  const membership = await addBranchManager(owner, ids);
  const db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 4 });
  const dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  const consumer = createPackageRefundNoticeConsumer(ids, { now: () => at });
  const deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  return {
    companyId: TENANT.A.company,
    businessId: TENANT.A.business,
    branchId: TENANT.A.branch,
    ids,
    at,
    db,
    owner,
    consumer,
    deliver,
    refund: async () => {
      const seeded = await seedRefund(owner, ids, membership);
      return { ...seeded, event: await storeEvent(db, ids, seeded) };
    },
    notices: (refundId: string) =>
      owner`SELECT * FROM package_refund_notices WHERE company_id=${TENANT.A.company} AND refund_id=${refundId}`,
    requests: (entitlementId: string) =>
      owner`SELECT * FROM outbox WHERE company_id=${TENANT.A.company} AND event_type='PackageRefundNoticeRequested'
        AND aggregate_id=${entitlementId} ORDER BY seq`,
    close: async () => {
      await dispatcher.close();
      await db.close();
      await owner.end();
      await testDb.drop();
    },
  };
}

export type PackageRefundNoticeFixture = Awaited<ReturnType<typeof packageRefundNoticeFixture>>;
interface RefundRows {
  entitlement: string;
  component: string;
  refund: string;
}

/** يزرع الباقة والاسترداد في معاملة واحدة عشان فحوص الاسترداد المؤجلة تشوف حالة متّسقة. */
async function seedRefund(
  owner: postgres.Sql,
  ids: { newId(): string },
  membership: string,
): Promise<RefundRows> {
  const company = TENANT.A.company;
  const business = TENANT.A.business;
  const branch = TENANT.A.branch;
  const entitlement = ids.newId();
  const component = ids.newId();
  const refund = ids.newId();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,
        refunded_amount,revision)
      VALUES(${company},${entitlement},${business},${ORDER_IDS.customer},${PACKAGE_TYPE_ID},'SOLD',
        'Synthetic package',30,${PACKAGE_PRICE},${PACKAGE_PRICE},0,0,'CASH',${ORDER_IDS.employee},
        ${branch},'2026-10-01T08:00:00Z'::timestamptz,'2026-10-01','Asia/Kuwait',${USER},
        ${ORDER_IDS.membership},'2026-12-30'::date,0,1)`;
    await tx`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
      VALUES(${company},${component},${business},${entitlement},${ORDER_IDS.service},1,'Synthetic service',
        ${REFUND_AMOUNT},2,${PACKAGE_PRICE})`;
    await tx`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      SELECT ${company}::uuid, gen_random_uuid(), ${business}::uuid, ${entitlement}::uuid,
        ${component}::uuid, n, ${REFUND_AMOUNT}::numeric, 'FREE' FROM generate_series(1, 2) n`;
    const [slot] = await tx`SELECT id FROM package_session_slots
      WHERE company_id=${company} AND entitlement_id=${entitlement} AND ordinal=2`;
    if (!slot) throw new Error('the seeded package has no second session');
    await tx`INSERT INTO package_refunds
      (company_id,id,business_id,entitlement_id,component_id,branch_id,sessions,amount,method,reason,
        refunded_by,refunded_by_membership_id,refunded_at,entitlement_revision)
      VALUES(${company},${refund},${business},${entitlement},${component},${branch},1,${REFUND_AMOUNT},
        'CASH',${REFUND_REASON},${REFUNDER_USER},${membership},${REFUNDED_AT}::timestamptz,2)`;
    await tx`INSERT INTO package_refund_slots
      (company_id,id,business_id,refund_id,entitlement_id,component_id,slot_id,ordinal,unit_value)
      VALUES(${company},${ids.newId()},${business},${refund},${entitlement},${component},${slot.id}::uuid,
        2,${REFUND_AMOUNT}::numeric)`;
    await tx`UPDATE package_session_slots SET state='REFUNDED' WHERE id=${slot.id}`;
    await tx`UPDATE package_entitlements SET refunded_amount=${REFUND_AMOUNT}, revision=2
      WHERE id=${entitlement}`;
  });
  return { entitlement, component, refund };
}

/** مدير الفرع هو نفسه المسترد، فالجرس لازم يوصله. */
async function addBranchManager(owner: postgres.Sql, ids: { newId(): string }): Promise<string> {
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${REFUNDER_USER},'Synthetic branch manager',${`${REFUNDER_USER}@example.test`},true,now(),now())`;
  const membership = ids.newId();
  const role = SYSTEM_ROLES.find((entry) => entry.code === 'branch_manager');
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${TENANT.A.company},${membership},${REFUNDER_USER},${role?.id ?? 'branch_manager'},
      ${role ? 'global' : TENANT.A.company},'BRANCH',${TENANT.A.branch},
      ${new Date('2026-01-01T00:00:00.000Z')},NULL)`;
  return membership;
}

/** حدث الاسترداد في الـ outbox؛ هو المصدر الوحيد لجرس الاسترداد. */
async function storeEvent(
  db: Database,
  ids: { newId(): string },
  seeded: RefundRows,
): Promise<ClaimedEvent> {
  const id = ids.newId();
  const payload = packageRefundRecorded.parse({
    schema_version: 1,
    refund_id: seeded.refund,
    entitlement_id: seeded.entitlement,
    component_id: seeded.component,
    business_id: TENANT.A.business,
    branch_id: TENANT.A.branch,
    sessions: 1,
    amount: REFUND_AMOUNT,
    business_date: REFUND_BUSINESS_DATE,
    refunded_at: REFUNDED_AT,
    entitlement_revision: 2,
  });
  await db.withTenant(TENANT.A.company, (tx) =>
    appendOutboxEvent(tx, id, {
      aggregateType: 'package_entitlement',
      aggregateId: seeded.entitlement,
      eventType: 'PackageRefundRecorded',
      payload,
    }),
  );
  return {
    companyId: TENANT.A.company,
    id,
    aggregateType: 'package_entitlement',
    aggregateId: seeded.entitlement,
    eventType: 'PackageRefundRecorded',
    payload,
    attempt: 1,
  };
}
