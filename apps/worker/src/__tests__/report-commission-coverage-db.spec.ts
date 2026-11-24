import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import type { ClaimedEvent, Database, OutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
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
  type CommissionCoverageScope,
} from '../modules/commissions/index.ts';
import {
  fakeBusinessTimeZone,
} from '../modules/commissions/__tests__/commission-line-projection-time-zone.ts';
import {
  commissionSalaryEvent,
  commissionSaleEvent,
} from '../modules/commissions/__tests__/commission-tip-salary-events.ts';
import {
  listCurrentPackageSales,
  readCurrentSessionTips,
  readServiceLineCoveragePage,
} from '../modules/orders/index.ts';
import { readSalaryCoveragePage } from '../modules/staff/index.ts';
import { businessTimeZone, companyOpen } from '../modules/tenancy/index.ts';
import { createDeliverer } from '../outbox/deliver.ts';
import { createTestCommissionInputsConsumer } from './commission-inputs-consumer.ts';
import { asReplicaOwner } from '../../../../packages/db/test/owner-cleanup.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let dispatcher: OutboxDispatcherDatabase;
const ids = systemUuidV7();
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const logger = createLogger('silent');

const { A, B } = COMMISSION_LINE_TENANTS;
const SESSION = '01920000-0000-7000-8000-0000000f0d01';
const FIRST = '01920000-0000-7000-8000-0000000f0a01';
const SECOND = '01920000-0000-7000-8000-0000000f0a02';
const STALE = '01920000-0000-7000-8000-0000000f0a03';
const FRESH = '01920000-0000-7000-8000-0000000f0a04';
const ORPHAN = '01920000-0000-7000-8000-0000000f0a05';
const B_LINE = '01920000-0000-7000-8000-0000000f0b01';

interface SeededLine {
  readonly id: string;
  readonly ordinal: number;
  readonly revision: number;
  readonly kind: 'session' | 'change';
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO service_sessions (company_id,id,business_id,branch_id,customer_id,
    customer_name,customer_phone_masked,recorded_by,recorded_by_membership_id,occurred_at,recorded_at,
    business_date,business_timezone,late) VALUES (${A.company},${SESSION},${A.business},${A.branch},
    ${A.customer},'Coverage customer','***123',${USER},${A.membership},now(),now(),current_date,
    'Asia/Kuwait',false),(${B.company},${SESSION},${B.business},${B.branch},${B.customer},
    'Coverage customer','***123',${USER},${B.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
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
  // التنضيف بيحذف صف المنفذين من غير رأس تغيير مسجّل، وحرّاس الإنتاج بيطلبوا الرأس ده.
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM line_performers`;
    await tx`DELETE FROM service_lines`;
    await tx`DELETE FROM commission_lines`;
    await tx`DELETE FROM commission_line_heads`;
    await tx`DELETE FROM commission_salaries`;
    await tx`DELETE FROM commission_sales`;
    await tx`DELETE FROM package_session_slots`;
    await tx`DELETE FROM package_components`;
    await tx`DELETE FROM package_entitlements`;
    await tx`DELETE FROM employee_salaries`;
    await tx`DELETE FROM consumed_events`;
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`DELETE FROM outbox`;
  });
});

const TIP_RANGE = { from: '2026-01-01', to: '2026-12-31' };

function rawCoverageReport() {
  return createCommissionCoverageReport({
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
}

// COVERED لا تُطبع بدون نطاق بقشيش (issue #1032)، فكل تشغيل هنا يحمل نشاط الشركة المفحوصة ما لم يُحدَّد نطاق.
function coverageReport() {
  const report = rawCoverageReport();
  return (scope: CommissionCoverageScope) =>
    report({
      tips: {
        businessIds: [scope.companyId === B.company ? B.business : A.business],
        ...TIP_RANGE,
      },
      ...scope,
    });
}

async function replayCompanyA(scope: 'FOUR_TYPE' | 'SIX_TYPE' = 'FOUR_TYPE'): Promise<void> {
  const failures = new Map<string, string>();
  const timezone = fakeBusinessTimeZone(A.business);
  const consumer = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone: timezone });
  const deliver = createDeliverer(db, [consumer], logger, { knownEventTypes: consumer.eventTypes });
  const result = await runCommissionInputReplay(
    {
      reader: dispatcher,
      deliver,
      failures,
      scope,
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

async function seedLine(tenant: typeof A | typeof B, line: SeededLine): Promise<ClaimedEvent> {
  const eventType = line.kind === 'change' ? 'ServiceLineChanged' : 'ServiceSessionRecorded';
  const event = commissionLineEvent(tenant, ids, eventType, {
    id: ids.newId(),
    sessionId: SESSION,
    lineId: line.id,
    revision: line.revision,
    net: '10.000',
    ...(line.kind === 'change' ? { changeKind: 'PRICE_DISCOUNT_EDIT' } : {}),
    performers: [{ employee_id: tenant.employee, share_bps: 10000 }],
  });
  await owner.begin(async (tx) => {
    await tx`INSERT INTO service_lines (company_id,id,business_id,session_id,service_id,ordinal,
      input_index,status,revision,list_price,price,discount,net,effective_discount_bps,limit_source,
      limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,
      recorded_by,recorded_by_membership_id,recorded_at,late) VALUES (${tenant.company},${line.id},
      ${tenant.business},${SESSION},${tenant.service},${line.ordinal},${line.ordinal - 1},'ACTIVE',
      ${line.revision},1.000,1.000,0.000,1.000,0,'OWNER',NULL,'Coverage service',1,'ZERO',true,false,
      ${USER},${tenant.membership},now(),false)`;
    await tx`INSERT INTO line_performers (company_id,id,business_id,line_id,employee_id,performer_ordinal,
      share_bps,name_en,not_clocked_in_warning,approved_leave_warning) VALUES (${tenant.company},
      ${ids.newId()},${tenant.business},${line.id},${tenant.employee},1,10000,'Coverage performer',false,false)`;
  });
  await insertOutbox(event);
  return event;
}

async function insertHead(lineId: string, revision: number): Promise<void> {
  await owner`INSERT INTO commission_line_heads (company_id,business_id,line_id,session_id,branch_id,
    service_id,customer_id,revision,status,business_date,period) VALUES (${A.company},${A.business},
    ${lineId},${SESSION},${A.branch},${A.service},${A.customer},${revision},'ACTIVE','2026-11-01','2026-11')`;
}

async function insertEmployeeSalary(effectiveFrom: string, revision: number): Promise<void> {
  await owner`INSERT INTO employee_salaries (company_id,id,business_id,employee_id,effective_from,amount,
    set_by,revision,reason) VALUES (${A.company},${ids.newId()},${A.business},${A.employee},
    ${effectiveFrom},500.000,${USER},${revision},'Coverage source seed')`;
}

it('CM-24 reports the uncovered lines and the unmarked events until the replay projects them', async () => {
  const recorded = await seedLine(A, { id: FIRST, ordinal: 1, revision: 1, kind: 'session' });
  const changed = await seedLine(A, { id: SECOND, ordinal: 2, revision: 2, kind: 'change' });

  const before = await coverageReport()({ companyId: A.company, throughId: null });
  expect(before.status).toBe('NOT_COVERED');
  expect(before.lines).toEqual({
    checked: 2,
    missing: { total: 2, ids: [FIRST, SECOND] },
    stale: { total: 0, ids: [] },
  });
  expect(before.unmarked).toEqual({
    checked: 2,
    total: 2,
    events: [
      { eventId: recorded.id, type: 'ServiceSessionRecorded' },
      { eventId: changed.id, type: 'ServiceLineChanged' },
    ],
  });

  await replayCompanyA();

  const after = await coverageReport()({ companyId: A.company, throughId: null });
  expect(after.status).toBe('COVERED');
  expect(after.lines.missing.total).toBe(0);
  expect(after.lines.stale.total).toBe(0);
  expect(after.unmarked.total).toBe(0);
});

it('lists a head behind its source line as stale and treats a newer head as covered', async () => {
  await seedLine(A, { id: STALE, ordinal: 1, revision: 2, kind: 'change' });
  await seedLine(A, { id: FRESH, ordinal: 2, revision: 2, kind: 'change' });
  await insertHead(STALE, 1);
  await insertHead(FRESH, 3);

  const result = await coverageReport()({ companyId: A.company, throughId: null });

  expect(result.lines).toEqual({
    checked: 2,
    missing: { total: 0, ids: [] },
    stale: { total: 1, ids: [STALE] },
  });
});

it('CM-25 covers a legacy salary only after the replay projects it', async () => {
  await insertEmployeeSalary('2026-11-01', 1);
  await insertOutbox(
    commissionSalaryEvent(A, ids, { businessId: null, amount: '500.000', revision: 1 }),
  );

  const before = await coverageReport()({ companyId: A.company, throughId: null });
  expect(before.status).toBe('NOT_COVERED');
  expect(before.salaries).toEqual({
    checked: 1,
    missing: { total: 1, ids: [`${A.employee}|2026-11-01`] },
    stale: { total: 0, ids: [] },
  });

  await replayCompanyA();

  const after = await coverageReport()({ companyId: A.company, throughId: null });
  expect(after.status).toBe('COVERED');
  expect(after.salaries.missing.total).toBe(0);
  expect(after.salaries.stale.total).toBe(0);
  expect(after.unmarked.total).toBe(0);
});

const SALE_TYPE = '01920000-0000-7000-8000-00000000f301';

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

/** باقة مستوردة بمعاينة استيراد حقيقية؛ المستورَد بلا بيع فلا حدث ولا يدخل تغطية البيع. */
async function seedImportedEntitlement(entitlementId: string): Promise<void> {
  const file = ids.newId();
  const preview = ids.newId();
  await owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES (${A.company},${file},${A.business},'import',${file},'synthetic-import-file',
    'application/pdf',10,'read:files:business',${USER},now())`;
  await owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
    created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${A.company},${preview},${A.business},'packages',${file},${USER},now(),
    now()+interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements
      (company_id,id,business_id,customer_id,provenance,name_en,price_paid,recorded_by,
        recorded_by_membership_id,external_ref,import_batch_id,import_row,expires_on,
        refunded_amount,revision)
      VALUES (${A.company},${entitlementId},${A.business},${A.customer},'IMPORTED',
        'Coverage imported package','30.000',${USER},${A.membership},${'EXT-' + entitlementId},
        ${preview},1,'2026-11-30','0.000',1)`);
    await tx.execute(sql`INSERT INTO package_components
      (company_id,id,business_id,entitlement_id,service_id,position,name_en,list_price_snapshot,
        sessions_total,component_value)
      VALUES (${A.company},${ids.newId()},${A.business},${entitlementId},${A.service},
      1,'Coverage component',30.000,1,30.000)`);
    const component = await tx.execute<{ id: string }>(sql`
      SELECT id FROM package_components WHERE company_id=${A.company} AND entitlement_id=${entitlementId}`);
    await tx.execute(sql`INSERT INTO package_session_slots
      (company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
      VALUES (${A.company},${ids.newId()},${A.business},${entitlementId},${component[0]?.id},
      1,30.000,'FREE')`);
  });
}

it('CM-20b covers a package sale only after the replay projects it and never counts an import', async () => {
  await seedSoldEntitlement(FIRST);
  await insertOutbox(commissionSaleEvent(A, ids, { saleId: FIRST }));
  await seedSoldEntitlement(STALE);
  await seedImportedEntitlement(SECOND);

  const before = await coverageReport()({ companyId: A.company, throughId: null });
  expect(before.status).toBe('NOT_COVERED');
  expect(before.sales).toEqual({
    checked: 2,
    missing: { total: 2, ids: [FIRST, STALE] },
    stale: { total: 0, ids: [] },
  });
  expect(before.unmarked.total).toBe(1);

  await replayCompanyA('SIX_TYPE');

  const after = await coverageReport()({ companyId: A.company, throughId: null });
  expect(after.status).toBe('NOT_COVERED');
  expect(after.sales).toEqual({
    checked: 2,
    missing: { total: 1, ids: [STALE] },
    stale: { total: 0, ids: [] },
  });
  expect(after.unmarked.total).toBe(0);

  await insertProjectedSaleRow(STALE, 1);
  const covered = await coverageReport()({ companyId: A.company, throughId: null });
  expect(covered.status).toBe('COVERED');
  expect(covered.sales.missing.total).toBe(0);
});

async function insertProjectedSaleRow(saleId: string, revision: number): Promise<void> {
  await owner`INSERT INTO commission_sales (company_id,id,business_id,sale_id,branch_id,
    seller_employee_id,business_date,period,price_paid,refunded_amount,status,revision)
    VALUES (${A.company},${ids.newId()},${A.business},${saleId},${A.branch},${A.employee},
    '2026-11-01','2026-11','30.000','0.000','SOLD',${revision})`;
}

it('keeps a source line missing when its retained event does not exist', async () => {
  const orphan = await seedLine(A, { id: ORPHAN, ordinal: 1, revision: 1, kind: 'session' });
  await seedLine(A, { id: FIRST, ordinal: 2, revision: 1, kind: 'session' });
  await asReplicaOwner(owner, (tx) => tx`DELETE FROM outbox WHERE id = ${orphan.id}`);

  await replayCompanyA();

  const result = await coverageReport()({ companyId: A.company, throughId: null });
  expect(result.status).toBe('NOT_COVERED');
  expect(result.lines.missing).toEqual({ total: 1, ids: [ORPHAN] });
  expect(result.lines.stale.total).toBe(0);
});

it('never reports the lines or the events of another tenant', async () => {
  const aEvent = await seedLine(A, { id: FIRST, ordinal: 1, revision: 1, kind: 'session' });
  const bEvent = await seedLine(B, { id: B_LINE, ordinal: 1, revision: 1, kind: 'session' });

  const forA = await coverageReport()({ companyId: A.company, throughId: null });
  const forB = await coverageReport()({ companyId: B.company, throughId: null });

  expect(forA.lines.missing.ids).toEqual([FIRST]);
  expect(forA.unmarked.events.map((event) => event.eventId)).toEqual([aEvent.id]);
  expect(forB.lines.missing.ids).toEqual([B_LINE]);
  expect(forB.unmarked.events.map((event) => event.eventId)).toEqual([bEvent.id]);
});

it('writes nothing while it reports and keeps the payload values out of the report', async () => {
  await seedLine(A, { id: FIRST, ordinal: 1, revision: 1, kind: 'session' });
  await insertEmployeeSalary('2026-11-01', 1);
  await insertOutbox(
    commissionSalaryEvent(A, ids, { businessId: null, amount: '500.000', revision: 1 }),
  );
  await replayCompanyA();

  const snapshot = async () => ({
    outbox: await owner`SELECT * FROM outbox ORDER BY id`,
    consumed: await owner`SELECT * FROM consumed_events ORDER BY company_id, consumer_id, event_id`,
    heads: await owner`SELECT * FROM commission_line_heads ORDER BY company_id, line_id`,
    salaries: await owner`SELECT * FROM commission_salaries ORDER BY company_id, employee_id, effective_from`,
  });
  const before = await snapshot();

  const result = await coverageReport()({ companyId: A.company, throughId: null });

  expect(await snapshot()).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('10.000');
});

it('refuses a business of another company and an unknown business before reading anything', async () => {
  await seedLine(A, { id: FIRST, ordinal: 1, revision: 1, kind: 'session' });
  const unknown = '01920000-0000-7000-8000-0000000f0e99';

  for (const businessIds of [[B.business], [A.business, B.business], [unknown]]) {
    await expect(
      rawCoverageReport()({
        companyId: A.company,
        throughId: null,
        tips: { businessIds, ...TIP_RANGE },
      }),
    ).rejects.toMatchObject({ code: 'COMMISSION_COVERAGE_SCOPE_INVALID' });
  }
});

it('prints COVERED only for a checked tip scope, and names that scope', async () => {
  const withoutScope = await rawCoverageReport()({ companyId: A.company, throughId: null });
  const withScope = await coverageReport()({ companyId: A.company, throughId: null });

  expect(withoutScope.status).toBe('NOT_COVERED');
  expect(withoutScope.tipScope).toBeNull();
  expect(withScope.status).toBe('COVERED');
  expect(withScope.tipScope).toEqual({ businessIds: [A.business], ...TIP_RANGE });
});
