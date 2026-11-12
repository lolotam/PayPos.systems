import {
  createDatabase,
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type Database,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import {
  recordCommissionFailureCodes,
  runCommissionInputReplay,
  type CommissionFailureCodes,
} from '../jobs/replay-commission-inputs.ts';
import { fakeBusinessTimeZone } from './commission-line-projection-time-zone.ts';
import { commissionSalaryEvent } from './commission-tip-salary-events.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let dispatcher: OutboxDispatcherDatabase;
const ids = systemUuidV7();
const { A } = COMMISSION_LINE_TENANTS;
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
});

afterAll(async () => {
  await dispatcher?.close();
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`DELETE FROM outbox`;
});

function createReplayHarness() {
  const failures: CommissionFailureCodes = new Map();
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: fakeBusinessTimeZone(A.business),
  });
  const wrapped = recordCommissionFailureCodes(consumer, failures);
  const deliver = createDeliverer(db, [wrapped], createLogger('silent'), {
    knownEventTypes: wrapped.eventTypes,
  });
  return { deliver, failures };
}

async function insertOutbox(event: ClaimedEvent): Promise<void> {
  await owner`INSERT INTO outbox (company_id, id, aggregate_type, aggregate_id, event_type, payload, published_at, attempts, next_attempt_at, parked_at, last_error)
    VALUES (${event.companyId}, ${event.id}, ${event.aggregateType}, ${event.aggregateId}, ${event.eventType}, ${JSON.stringify(event.payload)}::jsonb, NULL, 0, clock_timestamp(), NULL, NULL)`;
}

async function salaries(employeeId: string) {
  return owner`SELECT business_id AS "businessId", employee_id AS "employeeId", effective_from::text AS "effectiveFrom", amount::text AS amount, revision
    FROM commission_salaries WHERE company_id=${A.company} AND employee_id=${employeeId} ORDER BY effective_from, revision`;
}

it('CM-25 applies legacy SalaryChanged without business_id once, idempotently, and records missing employee failure', async () => {
  // يثبت تطبيق الراتب القديم عبر استنتاج النشاط وتوقف الاستعادة عند موظف مفقود دون إسقاط أو تعليم
  const { deliver, failures } = createReplayHarness();
  const legacyA = commissionSalaryEvent(A, ids, { id: eventId(100), businessId: null, amount: '500.000', revision: 1 });
  const missingEmpId = '01920000-0000-7000-8000-00000000e999';
  const legacyMissing = commissionSalaryEvent(A, ids, { id: eventId(200), employeeId: missingEmpId, aggregateId: missingEmpId, businessId: null, amount: '400.000', revision: 1 });

  await insertOutbox(legacyA);
  await insertOutbox(legacyMissing);

  const result = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );

  expect(result).toEqual({
    status: 'UNDELIVERED',
    afterId: eventId(200),
    throughId: eventId(200),
    counts: { SalaryChanged: 1 },
    undelivered: [{ eventId: legacyMissing.id, eventType: 'SalaryChanged', code: 'COMMISSION_EMPLOYEE_BUSINESS_MISSING' }],
    truncated: false,
  });

  // الموظف الأصلي أُسقط راتبه ونُسب لنشاطه الصحيح
  expect(await salaries(A.employee)).toEqual([
    { businessId: A.business, employeeId: A.employee, effectiveFrom: '2026-11-01', amount: '500.000', revision: 1 },
  ]);

  // الموظف غير الموجود لم يُكتب له أي صف ولم تُسجل له علامة استهلاك
  expect(await salaries(missingEmpId)).toEqual([]);
  const missingMark = await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id=${legacyMissing.id}`;
  expect(missingMark[0]?.count).toBe(0);

  // تكرار الاستعادة بالكامل لا يضيف صفوفاً جديدة ولا يغير المراجعة
  const repeatedResult = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: result.throughId },
  );
  expect(repeatedResult.status).toBe('UNDELIVERED');
  expect(await salaries(A.employee)).toEqual([
    { businessId: A.business, employeeId: A.employee, effectiveFrom: '2026-11-01', amount: '500.000', revision: 1 },
  ]);
});

it('delivers previously failed salary event after its cause is fixed on a full re-run without duplicating others', async () => {
  // يثبت أن معالجة سبب الفشل ثم إعادة التشغيل من البداية بنفس الحد الأعلى تُسلّم الحدث المتعثر دون تكرار
  const { deliver, failures } = createReplayHarness();
  const legacyA = commissionSalaryEvent(A, ids, { id: eventId(301), businessId: null, amount: '500.000', revision: 1 });
  const missingEmpId = '01920000-0000-7000-8000-00000000e998';
  const legacyMissing = commissionSalaryEvent(A, ids, { id: eventId(302), employeeId: missingEmpId, aggregateId: missingEmpId, businessId: null, amount: '400.000', revision: 1 });

  await insertOutbox(legacyA);
  await insertOutbox(legacyMissing);

  const firstRun = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );
  expect(firstRun.status).toBe('UNDELIVERED');

  // تصحيح السبب: إدراج الموظف في جدول employees وربطه بنشاط الشركة
  await owner`INSERT INTO employees (
    company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date, employee_number
  ) VALUES (
    ${A.company}, ${missingEmpId}, ${A.business}, ${A.branch}, 'Remediated Staff', 'remediatedstaff', 'staff', '2026-01-01', 98
  )`;

  // إعادة التشغيل الكاملة من البداية بنفس throughId
  const fixedRun = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: firstRun.throughId },
  );

  expect(fixedRun).toEqual({
    status: 'COMPLETE',
    afterId: eventId(302),
    throughId: firstRun.throughId,
    counts: { SalaryChanged: 1 },
    undelivered: [],
    truncated: false,
  });

  // الحدث المتعثر سابقاً أُسقط بنجاح والموظف السابق لم يتكرر صفه
  expect(await salaries(missingEmpId)).toEqual([
    { businessId: A.business, employeeId: missingEmpId, effectiveFrom: '2026-11-01', amount: '400.000', revision: 1 },
  ]);
  expect(await salaries(A.employee)).toEqual([
    { businessId: A.business, employeeId: A.employee, effectiveFrom: '2026-11-01', amount: '500.000', revision: 1 },
  ]);

  const marks = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`;
  expect(marks.map((m) => m.event_id).sort()).toEqual([legacyA.id, legacyMissing.id].sort());
});

it('produces the same commission_salaries rows when applied in forward or reverse effective date order', async () => {
  // يثبت أن ترتيب تواريخ سريان الرواتب في أحداث outbox لا يؤثر على الحالة النهائية في جدول الإسقاط
  const s1Forward = commissionSalaryEvent(A, ids, { id: eventId(401), effectiveFrom: '2026-03-01', amount: '300.000', revision: 1 });
  const s2Forward = commissionSalaryEvent(A, ids, { id: eventId(402), effectiveFrom: '2026-06-01', amount: '450.000', revision: 1 });

  await insertOutbox(s1Forward);
  await insertOutbox(s2Forward);

  const { deliver: deliverForward, failures: failuresForward } = createReplayHarness();
  await runCommissionInputReplay(
    { reader: dispatcher, deliver: deliverForward, failures: failuresForward },
    { companyId: A.company, afterId: null, throughId: null },
  );

  const forwardSalaries = await salaries(A.employee);
  expect(forwardSalaries).toEqual([
    { businessId: A.business, employeeId: A.employee, effectiveFrom: '2026-03-01', amount: '300.000', revision: 1 },
    { businessId: A.business, employeeId: A.employee, effectiveFrom: '2026-06-01', amount: '450.000', revision: 1 },
  ]);

  // تنظيف كامل قبل تجربة الترتيب العكسي
  await owner`DELETE FROM commission_salaries WHERE company_id=${A.company}`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`DELETE FROM outbox WHERE company_id=${A.company}`;

  // بالترتيب العكسي: التاريخ الأحدث (يونيو) يُدرج بمعرف أقل ليُقرأ أولاً في الاستعادة
  const s2Reverse = commissionSalaryEvent(A, ids, { id: eventId(501), effectiveFrom: '2026-06-01', amount: '450.000', revision: 1 });
  const s1Reverse = commissionSalaryEvent(A, ids, { id: eventId(502), effectiveFrom: '2026-03-01', amount: '300.000', revision: 1 });

  await insertOutbox(s2Reverse);
  await insertOutbox(s1Reverse);

  const { deliver: deliverReverse, failures: failuresReverse } = createReplayHarness();
  await runCommissionInputReplay(
    { reader: dispatcher, deliver: deliverReverse, failures: failuresReverse },
    { companyId: A.company, afterId: null, throughId: null },
  );

  const reverseSalaries = await salaries(A.employee);
  expect(reverseSalaries).toEqual(forwardSalaries);
});
