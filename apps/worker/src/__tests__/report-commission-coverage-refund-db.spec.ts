import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import type { ClaimedEvent, Database, OutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createCommissionCoverageReport,
  runCommissionInputReplay,
} from '../modules/commissions/index.ts';
import { fakeBusinessTimeZone } from '../modules/commissions/__tests__/commission-line-projection-time-zone.ts';
import { commissionSaleEvent } from '../modules/commissions/__tests__/commission-tip-salary-events.ts';
import {
  listCurrentPackageSales,
  readCurrentSessionTips,
  readServiceLineCoveragePage,
} from '../modules/orders/index.ts';
import { readSalaryCoveragePage } from '../modules/staff/index.ts';
import { businessTimeZone, companyOpen } from '../modules/tenancy/index.ts';
import { createDeliverer } from '../outbox/deliver.ts';
import { createTestCommissionInputsConsumer } from './commission-inputs-consumer.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let dispatcher: OutboxDispatcherDatabase;
const ids = systemUuidV7();
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const logger = createLogger('silent');

const { A } = COMMISSION_LINE_TENANTS;
const SALE_TYPE = '01920000-0000-7000-8000-00000000f301';
const SALE = '01920000-0000-7000-8000-0000000f0a03';
const TIP_RANGE = { from: '2026-01-01', to: '2026-12-31' };

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${SALE_TYPE},${A.business},'Coverage package type',1.000,30)`;
  db = createDatabase({ url: testDb.appUrl, ids });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
});

afterAll(async () => {
  await dispatcher?.close();
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

afterEach(async () => {
  // التنضيف بيحذف الصفوف من غير رأس تغيير مسجّل، وحرّاس الإنتاج بيطلبوا الرأس ده.
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM commission_sales`;
    await tx`DELETE FROM package_session_slots`;
    await tx`DELETE FROM package_components`;
    await tx`DELETE FROM package_entitlements`;
    await tx`DELETE FROM consumed_events`;
    await tx`DELETE FROM outbox`;
  });
});

// COVERED لا تُطبع بدون نطاق بقشيش (issue #1032)، فالتقرير هنا يحمل نشاط الشركة المفحوصة.
function coverageReport() {
  const report = createCommissionCoverageReport({
    database: db,
    lines: { readPage: readServiceLineCoveragePage },
    salaries: { readPage: readSalaryCoveragePage },
    sales: { readPage: listCurrentPackageSales },
    retained: dispatcher,
    companies: { isOpen: companyOpen },
    businesses: {
      isInCompany: async (tx, companyId, businessId) =>
        (await businessTimeZone(tx, companyId, businessId)) !== null,
    },
    tipsReader: { readPage: readCurrentSessionTips },
  });
  return report({
    companyId: A.company,
    throughId: null,
    tips: { businessIds: [A.business], ...TIP_RANGE },
  });
}

async function replayCompanyA(): Promise<void> {
  const failures = new Map<string, string>();
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  const deliver = createDeliverer(db, [consumer], logger, { knownEventTypes: consumer.eventTypes });
  const result = await runCommissionInputReplay(
    {
      reader: dispatcher,
      deliver,
      failures,
      scope: 'SIX_TYPE',
      handledTypes: new Set(consumer.eventTypes),
    },
    { companyId: A.company, afterId: null, throughId: null },
  );
  expect(result.status).toBe('COMPLETE');
}

async function insertOutbox(event: ClaimedEvent): Promise<void> {
  await owner`INSERT INTO outbox (company_id,id,aggregate_type,aggregate_id,event_type,payload)
    VALUES (${event.companyId},${event.id},${event.aggregateType},${event.aggregateId},${event.eventType},
    ${owner.json(event.payload as never)})`;
}

async function seedSoldEntitlement(saleId: string): Promise<void> {
  // قيد سلامة التشغيل مؤجَّل حتى نهاية المعاملة، فالباكدج ومكوّنه في معاملة واحدة.
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,package_type_id,provenance,name_en,validity_days,list_price,
        price_paid,discount,discount_bps,paid_method,seller_employee_id,sold_branch_id,sold_at,
        sold_business_date,sold_timezone,recorded_by,recorded_by_membership_id,expires_on,
        refunded_amount,revision)
      VALUES (${A.company},${saleId},${A.business},${A.customer},${SALE_TYPE},'SOLD','Coverage package',
        30,'1.000','30.000','0.000',0,'CASH',${A.employee},${A.branch},now(),'2026-11-01','Asia/Kuwait',
        ${USER},${A.membership},'2026-11-30','0.000',1)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,
        sessions_total,component_value)
      VALUES (${A.company},${ids.newId()},${A.business},${saleId},${A.service},
      1,'Coverage component',30.000,1,30.000)`);
    const component = await tx.execute<{ id: string }>(sql`
      SELECT id FROM package_components WHERE company_id=${A.company} AND entitlement_id=${saleId}`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${ids.newId()},${A.business},${saleId},${component[0]?.id},
      1,30.000,'FREE')`);
  });
}

/**
 * يقدّم باقة مبيعة لمراجعة أحدث باسترداد زي ما يعمل مسار الاسترداد الحقيقي.
 * المسار الحقيقي بيكتب صف الاسترداد وأسطره، وده خارج موضوع التغطية، فبنتخطى الحرّاس
 * بصلاحية المالك داخل معاملة واحدة (نفس أسلوب التنضيف فوق).
 */
async function advanceSoldEntitlement(
  saleId: string,
  refundedAmount: string,
  revision: number,
): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`UPDATE package_entitlements SET refunded_amount = ${refundedAmount}, revision = ${revision}
      WHERE company_id = ${A.company} AND id = ${saleId}`;
  });
}

async function insertProjectedSaleRow(saleId: string, revision: number): Promise<void> {
  await owner`INSERT INTO commission_sales (company_id,id,business_id,sale_id,branch_id,
    seller_employee_id,business_date,period,price_paid,refunded_amount,status,revision)
    VALUES (${A.company},${ids.newId()},${A.business},${saleId},${A.branch},${A.employee},
    '2026-11-01','2026-11','30.000','0.000','SOLD',${revision})`;
}

it('advances a stale sale head to its latest revision when the replay delivers the retained refund event', async () => {
  const refundedAmount = '10.000';
  await seedSoldEntitlement(SALE);
  await advanceSoldEntitlement(SALE, refundedAmount, 2);
  // الإسقاط لسه على المراجعة الأولى، والحدث المحتفظ به هو اللي بيحمل المراجعة الأحدث.
  await insertProjectedSaleRow(SALE, 1);
  const retained = commissionSaleEvent(A, ids, { saleId: SALE, revision: 2, refundedAmount });
  await insertOutbox(retained);

  const before = await coverageReport();
  expect(before.status).toBe('NOT_COVERED');
  expect(before.sales).toEqual({
    checked: 1,
    missing: { total: 0, ids: [] },
    stale: { total: 1, ids: [SALE] },
  });
  expect(before.unmarked).toEqual({
    checked: 1,
    total: 1,
    events: [{ eventId: retained.id, type: 'PackageSaleChanged' }],
  });

  await replayCompanyA();

  const [head] = await owner`SELECT revision, refunded_amount::text AS refunded_amount,
    price_paid::text AS price_paid, status FROM commission_sales
    WHERE company_id = ${A.company} AND sale_id = ${SALE}`;
  expect(head).toEqual({
    revision: 2,
    refunded_amount: refundedAmount,
    price_paid: '30.000',
    status: 'SOLD',
  });
  const consumed = await owner`SELECT 1 FROM consumed_events WHERE company_id = ${A.company}
    AND consumer_id = 'commissions.project-inputs' AND event_id = ${retained.id}`;
  expect(consumed).toHaveLength(1);

  const after = await coverageReport();
  expect(after.status).toBe('COVERED');
  expect(after.sales.missing.total).toBe(0);
  expect(after.sales.stale.total).toBe(0);
  expect(after.unmarked.total).toBe(0);
});
