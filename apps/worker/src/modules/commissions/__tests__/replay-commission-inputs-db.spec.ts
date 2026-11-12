import {
  createDatabase,
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type Database,
  type OutboxDispatcherDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  commissionLineEvent,
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
import { commissionSalaryEvent } from './commission-tip-salary-events.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let dispatcher: OutboxDispatcherDatabase;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;
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
  await owner`DELETE FROM commission_lines`;
  await owner`DELETE FROM commission_line_heads`;
  await owner`DELETE FROM commission_salaries`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  await owner`DELETE FROM outbox`;
});

function createReplayHarness() {
  const failures: CommissionFailureCodes = new Map();
  const consumer = createTestCommissionInputsConsumer({
    ids,
    clock,
    businessTimeZone: async (_tx, _companyId, businessId) =>
      businessId === A.business || businessId === B.business ? 'Asia/Kuwait' : null,
  });
  const wrapped = recordCommissionFailureCodes(consumer, failures);
  const deliver = createDeliverer(db, [wrapped], createLogger('silent'), {
    knownEventTypes: wrapped.eventTypes,
  });
  return { deliver, failures };
}

async function insertOutbox(
  event: ClaimedEvent,
  opts: { published?: boolean; parked?: boolean; attempts?: number; lastError?: string | null } = {},
): Promise<void> {
  const publishedAt = opts.published ? new Date('2026-11-01T10:00:00Z') : null;
  const parkedAt = opts.parked ? new Date('2026-11-01T10:00:00Z') : null;
  await owner`INSERT INTO outbox (
    company_id, id, aggregate_type, aggregate_id, event_type, payload,
    published_at, attempts, next_attempt_at, parked_at, last_error
  ) VALUES (
    ${event.companyId}, ${event.id}, ${event.aggregateType}, ${event.aggregateId}, ${event.eventType},
    ${owner.json(event.payload as never)}, ${publishedAt}, ${opts.attempts ?? (opts.parked ? 10 : 0)},
    clock_timestamp(), ${parkedAt}, ${opts.lastError ?? (opts.parked ? 'ParkedError' : null)}
  )`;
}

async function outboxSnapshot(companyId: string) {
  return owner`SELECT id, published_at, attempts, next_attempt_at, parked_at, last_error
    FROM outbox WHERE company_id=${companyId} ORDER BY id`;
}

it('CM-24 replays published, unpublished and parked line events and ignores lower revisions', async () => {
  // يثبت استعادة الأحداث بأنواعها الثلاثة بغض النظر عن حالة نشر outbox مع تطبيق حارس المراجعة
  const { deliver, failures } = createReplayHarness();
  const sessionRecorded = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    id: eventId(100), sessionId: COMMISSION_LINE_IDS.sessionA,
    lines: [{ lineId: COMMISSION_LINE_IDS.lineA, revision: 1, net: '10.000', performers: [{ employee_id: A.employee, share_bps: 10000 }] }],
  });
  const linesAdded = commissionLineEvent(A, ids, 'ServiceSessionLinesAdded', {
    id: eventId(200), sessionId: COMMISSION_LINE_IDS.sessionA,
    lines: [{ lineId: COMMISSION_LINE_IDS.lineB, revision: 1, net: '20.000', performers: [{ employee_id: COMMISSION_LINE_IDS.secondEmployee, share_bps: 10000 }] }],
  });
  const lineChanged = commissionLineEvent(A, ids, 'ServiceLineChanged', {
    id: eventId(300), sessionId: COMMISSION_LINE_IDS.sessionA, lineId: COMMISSION_LINE_IDS.lineA, revision: 2,
    changeKind: 'PRICE_DISCOUNT_EDIT', net: '15.000', previousNet: '10.000',
    performers: [{ employee_id: A.employee, share_bps: 10000 }],
  });

  await insertOutbox(sessionRecorded, { published: true, attempts: 1 });
  await insertOutbox(linesAdded, { published: false, attempts: 0 });
  await insertOutbox(lineChanged, { parked: true, attempts: 10, lastError: 'Stalled' });

  const result = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );

  expect(result).toEqual({
    status: 'COMPLETE',
    afterId: eventId(300),
    throughId: eventId(300),
    counts: { ServiceSessionRecorded: 1, ServiceSessionLinesAdded: 1, ServiceLineChanged: 1 },
    undelivered: [],
    truncated: false,
  });

  const heads = await owner`SELECT line_id, revision, status FROM commission_line_heads WHERE company_id=${A.company} ORDER BY line_id`;
  expect(heads).toEqual([
    { line_id: COMMISSION_LINE_IDS.lineA, revision: 2, status: 'ACTIVE' },
    { line_id: COMMISSION_LINE_IDS.lineB, revision: 1, status: 'ACTIVE' },
  ]);

  const lines = await owner`SELECT line_id, employee_id, net_share FROM commission_lines WHERE company_id=${A.company} ORDER BY line_id`;
  expect(lines).toEqual([
    { line_id: COMMISSION_LINE_IDS.lineA, employee_id: A.employee, net_share: '15.000' },
    { line_id: COMMISSION_LINE_IDS.lineB, employee_id: COMMISSION_LINE_IDS.secondEmployee, net_share: '20.000' },
  ]);

  // وصول حدث حي لاحق بنفس المراجعة أو مراجعة أقدم لا يغيّر الصفوف المسقطة
  const staleRev2 = commissionLineEvent(A, ids, 'ServiceLineChanged', {
    sessionId: COMMISSION_LINE_IDS.sessionA, lineId: COMMISSION_LINE_IDS.lineA, revision: 2,
    changeKind: 'PRICE_DISCOUNT_EDIT', net: '99.000', performers: [{ employee_id: A.employee, share_bps: 10000 }],
  });
  expect(await deliver(staleRev2)).toEqual({ delivered: true });

  // مراجعة 1 الأقدم تصل كتسجيل جلسة جديد بهوية حدث مختلفة؛ ServiceLineChanged بمراجعة 1 أصلاً غير صالح
  const staleRev1 = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    sessionId: COMMISSION_LINE_IDS.sessionA,
    lines: [{ lineId: COMMISSION_LINE_IDS.lineA, revision: 1, net: '88.000', performers: [{ employee_id: A.employee, share_bps: 10000 }] }],
  });
  expect(await deliver(staleRev1)).toEqual({ delivered: true });

  const unchangedLines = await owner`SELECT line_id, employee_id, net_share FROM commission_lines WHERE company_id=${A.company} AND line_id=${COMMISSION_LINE_IDS.lineA}`;
  expect(unchangedLines).toEqual([{ line_id: COMMISSION_LINE_IDS.lineA, employee_id: A.employee, net_share: '15.000' }]);
});

it('replaying then live dispatchBatch produces exactly one projection effect and sets published_at only on live path', async () => {
  // يثبت أن إعادة التشغيل تمنع تكرار الإسقاط عبر علامة الاستهلاك وتترك توثيق النشر للمرسل الحي
  const { deliver, failures } = createReplayHarness();
  const session = commissionLineEvent(A, ids, 'ServiceSessionRecorded', {
    id: eventId(400), sessionId: COMMISSION_LINE_IDS.sessionA,
    lines: [{ lineId: COMMISSION_LINE_IDS.lineA, revision: 1, net: '10.000', performers: [{ employee_id: A.employee, share_bps: 10000 }] }],
  });
  await insertOutbox(session, { published: false, attempts: 0 });

  await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );

  expect((await owner`SELECT published_at FROM outbox WHERE id=${session.id}`)[0]?.published_at).toBeNull();
  expect(await owner`SELECT count(*)::int AS count FROM commission_line_heads WHERE line_id=${COMMISSION_LINE_IDS.lineA}`).toMatchObject([{ count: 1 }]);
  expect(await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id=${session.id}`).toMatchObject([{ count: 1 }]);

  // تشغيل الدفعة الحية يعتمد الحدث في outbox دون تكرار إسقاط السطور
  const dispatched = await dispatcher.dispatchBatch(10, deliver);
  expect(dispatched).toBe(1);

  expect((await owner`SELECT published_at FROM outbox WHERE id=${session.id}`)[0]?.published_at).not.toBeNull();
  expect(await owner`SELECT count(*)::int AS count FROM commission_line_heads WHERE line_id=${COMMISSION_LINE_IDS.lineA}`).toMatchObject([{ count: 1 }]);
  expect(await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id=${session.id}`).toMatchObject([{ count: 1 }]);
});

it('leaves outbox rows intact across replay while adding consumed marks', async () => {
  // يضمن عدم تعديل أي حقل تشغيلي في جدول outbox مع حصر الكتابة في إضافة علامات الاستهلاك
  const { deliver, failures } = createReplayHarness();
  const e1 = commissionLineEvent(A, ids, 'ServiceSessionRecorded', { id: eventId(501) });
  const e2 = commissionLineEvent(A, ids, 'ServiceSessionLinesAdded', { id: eventId(502) });
  const e3 = commissionLineEvent(A, ids, 'ServiceLineChanged', { id: eventId(503), revision: 2 });

  await insertOutbox(e1, { published: true, attempts: 1 });
  await insertOutbox(e2, { published: false, attempts: 0 });
  await insertOutbox(e3, { parked: true, attempts: 8, lastError: 'ManualHold' });

  const before = await outboxSnapshot(A.company);
  const marksBefore = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;

  await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );

  expect(await outboxSnapshot(A.company)).toEqual(before);
  const marksAfter = await owner`SELECT event_id FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
  expect(marksAfter.length).toBe(marksBefore.length + 3);
});

it('skips event committed behind the cursor during replay and delivers it via live dispatchBatch', async () => {
  // الحدث الذي يُدرج خلف المؤشر أثناء الترحيل لا يلتقطه المسترجع ويُسلّم لاحقاً عبر المرسل الحي
  const { deliver, failures } = createReplayHarness();
  const e1 = commissionLineEvent(A, ids, 'ServiceSessionRecorded', { id: eventId(610), sessionId: COMMISSION_LINE_IDS.sessionA });
  const e3 = commissionLineEvent(A, ids, 'ServiceSessionLinesAdded', { id: eventId(630), sessionId: COMMISSION_LINE_IDS.sessionA });
  const lateEvent = commissionLineEvent(A, ids, 'ServiceLineChanged', {
    id: eventId(605), sessionId: COMMISSION_LINE_IDS.sessionA, lineId: COMMISSION_LINE_IDS.lineA, revision: 2,
    changeKind: 'PRICE_DISCOUNT_EDIT', net: '15.000', previousNet: '10.000',
    performers: [{ employee_id: A.employee, share_bps: 10000 }],
  });

  await insertOutbox(e1, { published: false, attempts: 0 });
  await insertOutbox(e3, { published: false, attempts: 0 });

  const reader = {
    commissionInputReplayPage: async (
      companyId: string,
      afterId: string | null,
      throughId: string | null,
      limit: number,
    ) => {
      const page = await dispatcher.commissionInputReplayPage(companyId, afterId, throughId, limit);
      if (afterId === null) {
        await insertOutbox(lateEvent, { published: false, attempts: 0 });
      }
      return page;
    },
  };

  const result = await runCommissionInputReplay(
    { reader, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );
  expect(result.status).toBe('COMPLETE');

  const lateMarkAfterReplay = await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id=${lateEvent.id}`;
  expect(lateMarkAfterReplay[0]?.count).toBe(0);

  // الـ dispatcher بيمرّر حدث واحد لكل aggregate في الدفعة، فالحدث المتأخر يحتاج دفعة بعد دفعة أقدم أحداثه
  let dispatched = 0;
  for (let round = 0; round < 4; round++) dispatched += await dispatcher.dispatchBatch(10, deliver);
  expect(dispatched).toBeGreaterThanOrEqual(3);

  const lateMarkAfterLive = await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id=${lateEvent.id}`;
  expect(lateMarkAfterLive[0]?.count).toBe(1);

  const lateOutbox = await owner`SELECT published_at FROM outbox WHERE id=${lateEvent.id}`;
  expect(lateOutbox[0]?.published_at).not.toBeNull();
});

it('preserves tenant isolation: replaying company A leaves company B untouched and enforces cross-tenant zero reads', async () => {
  // يثبت عزل المستأجر التام: استعادة شركة A لا تقرأ ولا تسقط ولا تعلّم أي حدث لشركة B
  const { deliver, failures } = createReplayHarness();
  const aEvents = [
    commissionLineEvent(A, ids, 'ServiceSessionRecorded', { id: eventId(701) }),
    commissionLineEvent(A, ids, 'ServiceSessionLinesAdded', { id: eventId(702) }),
    commissionLineEvent(A, ids, 'ServiceLineChanged', { id: eventId(703), revision: 2 }),
    commissionSalaryEvent(A, ids, { id: eventId(704) }),
  ];
  for (const e of aEvents) {
    await insertOutbox(e, { published: false, attempts: 0 });
  }

  const bEvents = [
    commissionLineEvent(B, ids, 'ServiceSessionRecorded', { id: eventId(801), lineId: '01920000-0000-7000-8000-00000000db01', sessionId: '01920000-0000-7000-8000-00000000db02' }),
    commissionLineEvent(B, ids, 'ServiceSessionLinesAdded', { id: eventId(802), lineId: '01920000-0000-7000-8000-00000000db03', sessionId: '01920000-0000-7000-8000-00000000db02' }),
    commissionLineEvent(B, ids, 'ServiceLineChanged', { id: eventId(803), lineId: '01920000-0000-7000-8000-00000000db01', sessionId: '01920000-0000-7000-8000-00000000db02', revision: 2 }),
    commissionSalaryEvent(B, ids, { id: eventId(804) }),
  ];
  for (const e of bEvents) {
    await insertOutbox(e, { published: false, attempts: 0 });
  }

  const beforeB = await outboxSnapshot(B.company);

  const result = await runCommissionInputReplay(
    { reader: dispatcher, deliver, failures },
    { companyId: A.company, afterId: null, throughId: null },
  );
  expect(result.status).toBe('COMPLETE');

  // أحداث شركة B لم تتغير في outbox ولم تُسجل في consumed_events
  expect(await outboxSnapshot(B.company)).toEqual(beforeB);
  const bEventIds = bEvents.map((e) => e.id);
  const bMarks = await owner`SELECT count(*)::int AS count FROM consumed_events WHERE consumer_id='commissions.project-inputs' AND event_id IN ${owner(bEventIds)}`;
  expect(bMarks[0]?.count).toBe(0);

  // جداول إسقاط شركة B فارغة تماماً
  expect(await owner`SELECT count(*)::int AS count FROM commission_line_heads WHERE company_id=${B.company}`).toMatchObject([{ count: 0 }]);
  expect(await owner`SELECT count(*)::int AS count FROM commission_lines WHERE company_id=${B.company}`).toMatchObject([{ count: 0 }]);
  expect(await owner`SELECT count(*)::int AS count FROM commission_salaries WHERE company_id=${B.company}`).toMatchObject([{ count: 0 }]);

  // فحص العزل السلبي RLS عبر اتصال المستأجر: شركة B ترى صفر صفوف من إسقاط شركة A
  const crossTenantRead = await db.withTenant(B.company, async (tx) =>
    tx.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM commission_line_heads`),
  );
  expect(crossTenantRead[0]?.count).toBe(0);
});
