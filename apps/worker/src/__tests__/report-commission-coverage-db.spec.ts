import { createDatabase, createOutboxDispatcherDatabase } from '@pospay/db';
import type { ClaimedEvent, Database, OutboxDispatcherDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
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
} from '../modules/commissions/index.ts';
import {
  fakeBusinessTimeZone,
} from '../modules/commissions/__tests__/commission-line-projection-time-zone.ts';
import {
  commissionSalaryEvent,
} from '../modules/commissions/__tests__/commission-tip-salary-events.ts';
import { readServiceLineCoveragePage } from '../modules/orders/index.ts';
import { readSalaryCoveragePage } from '../modules/staff/index.ts';
import { createDeliverer } from '../outbox/deliver.ts';
import { createTestCommissionInputsConsumer } from './commission-inputs-consumer.ts';

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
    await tx`DELETE FROM employee_salaries`;
    await tx`DELETE FROM consumed_events`;
    await tx`DELETE FROM outbox`;
  });
});

function coverageReport() {
  return createCommissionCoverageReport({
    database: db,
    lines: { readPage: readServiceLineCoveragePage },
    salaries: { readPage: readSalaryCoveragePage },
    retained: dispatcher,
  });
}

async function replayCompanyA(): Promise<void> {
  const failures = new Map<string, string>();
  const timezone = fakeBusinessTimeZone(A.business);
  const consumer = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone: timezone });
  const deliver = createDeliverer(db, [consumer], logger, { knownEventTypes: consumer.eventTypes });
  const result = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
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
      { eventId: recorded.id, eventType: 'ServiceSessionRecorded' },
      { eventId: changed.id, eventType: 'ServiceLineChanged' },
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

it('keeps a source line missing when its retained event does not exist', async () => {
  const orphan = await seedLine(A, { id: ORPHAN, ordinal: 1, revision: 1, kind: 'session' });
  await seedLine(A, { id: FIRST, ordinal: 2, revision: 1, kind: 'session' });
  await owner`DELETE FROM outbox WHERE id = ${orphan.id}`;

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
