import { createDatabase, OWNER_ROLE_ID, type ClaimedEvent, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  COMMISSION_LINE_IDS,
  COMMISSION_LINE_TENANTS,
  seedCommissionLineTenants,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { ORDER_IDS } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  revisionRow,
  tipRow,
  writeRevision,
  type TipCtx,
} from '../../../../../../packages/db/test/session-tip.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestCommissionTipsBootstrap,
  type CommissionTipsBootstrapScope,
} from '../../../__tests__/commission-tips-bootstrap.ts';
import { createTestCommissionInputsConsumer } from '../../../__tests__/commission-inputs-consumer.ts';
import { createDeliverer } from '../../../outbox/deliver.ts';
import type { CurrentTipSessionsReader } from '../index.ts';
import { commissionTipEvent } from './commission-tip-salary-events.ts';

type Method = 'CASH' | 'CARD';
type TipInput = { readonly employeeId: string; readonly method: Method; readonly amount: string };
type ConsumerDependencies = Parameters<typeof createTestCommissionInputsConsumer>[0];
type TipEventOverrides = Parameters<typeof commissionTipEvent>[2];

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
let deliver: (event: ClaimedEvent) => Promise<unknown>;
const ids = systemUuidV7();
const { A, B } = COMMISSION_LINE_TENANTS;
const CUSTOMER_A = COMMISSION_LINE_IDS.customerA;
const CUSTOMER_B = COMMISSION_LINE_IDS.customerB;
const clock = { now: () => new Date('2026-12-05T09:00:00Z') };
const eventId = (n: number) => `01970000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SCOPE: CommissionTipsBootstrapScope = {
  companyId: A.company,
  businessIds: [A.business],
  from: '2026-11-01',
  to: '2026-12-31',
};
const businessTimeZone: ConsumerDependencies['businessTimeZone'] = async (
  _tx,
  _companyId,
  businessId,
) => (businessId === A.business || businessId === B.business ? 'Asia/Kuwait' : null);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionLineTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await seedRecorder();
  const consumer = createTestCommissionInputsConsumer({ ids, clock, businessTimeZone });
  deliver = createDeliverer(db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await owner`DELETE FROM commission_tips`;
  await owner`DELETE FROM commission_tip_heads`;
  await owner`DELETE FROM commission_statements`;
  await owner`DELETE FROM session_tips`;
  await owner`DELETE FROM session_tip_revisions`;
  await owner`DELETE FROM service_sessions`;
  await owner`DELETE FROM consumed_events WHERE consumer_id='commissions.project-inputs'`;
});

async function seedRecorder(): Promise<void> {
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    VALUES(${USER},'Synthetic recorder','tips-bootstrap@example.test',true,now(),now())
    ON CONFLICT DO NOTHING`;
  for (const tenant of [A, B]) {
    await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      VALUES(${tenant.company},${ORDER_IDS.membership},${USER},${OWNER_ROLE_ID},'global','COMPANY',${tenant.company})
      ON CONFLICT DO NOTHING`;
  }
}

const tip = (employeeId: string, method: Method, amount: string) => ({ employeeId, method, amount });
const eventTip = (emp: string, method: Method, amount: string) => ({ employee_id: emp, method, amount });
const tipEvent = (
  id: string,
  sessionId: string,
  revision: number,
  tips: NonNullable<NonNullable<TipEventOverrides>['tips']>,
) => commissionTipEvent(A, ids, { id, sessionId, revision, businessDate: '2026-12-02', tips });
const tipCtx = (tenant: CommissionLineTenant): TipCtx => ({
  company: tenant.company,
  business: tenant.business,
  branch: tenant.branch,
  userId: USER,
  membershipId: ORDER_IDS.membership,
  sessionId: '',
  employeeId: tenant.employee,
});
const seedSession = async (
  tenant: CommissionLineTenant,
  businessDate: string,
  customerId: string,
) => {
  const ctx = tipCtx(tenant);
  const sessionId = ids.newId();
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
    VALUES(${ctx.company},${sessionId},${ctx.business},${ctx.branch},${customerId},'Synthetic customer','***123',
      ${ctx.userId},${ctx.membershipId},now(),now(),${businessDate}::date,'Asia/Kuwait',false)`;
  return { ctx, sessionId };
};

async function writeTipRevision(
  ctx: TipCtx,
  sessionId: string,
  revision: number,
  event: string,
  tips: readonly TipInput[],
): Promise<string> {
  const row = revisionRow(ids, sessionId, revision, { eventId: event });
  const rows = tips.map((entry) => tipRow(ids, row.id, sessionId, { ...entry }));
  await writeRevision(db, ctx, row, rows);
  return row.eventId;
}

const bootstrap = (wrapReader?: (real: CurrentTipSessionsReader) => CurrentTipSessionsReader) => {
  const dependencies = { ids, clock, businessTimeZone, database: db };
  return createTestCommissionTipsBootstrap(
    wrapReader === undefined ? dependencies : { ...dependencies, wrapReader },
  );
};
const headOf = async (sessionId: string) => {
  const [row] = await owner`SELECT business_id, branch_id, revision, business_date::text AS business_date, period
    FROM commission_tip_heads WHERE session_id=${sessionId}`;
  return row;
};
const revisionOf = async (sessionId: string) => (await headOf(sessionId))?.revision;
const rowsOf = (sessionId: string) =>
  owner`SELECT employee_id, method, amount::text AS amount FROM commission_tips
    WHERE session_id=${sessionId} ORDER BY employee_id, method`;
const expectRows = async (sessionId: string, expected: readonly unknown[]) =>
  expect(await rowsOf(sessionId)).toEqual(expected);
const markedIds = async () =>
  (await owner`SELECT event_id FROM consumed_events
    WHERE consumer_id='commissions.project-inputs' ORDER BY event_id`).map((row) => row.event_id);
const outboxSnapshot = (companyId: string) =>
  owner`SELECT id, published_at, attempts, next_attempt_at, parked_at, last_error
    FROM outbox WHERE company_id=${companyId} ORDER BY id`;

async function insertOutbox(aggregateId: string, event: string): Promise<void> {
  await owner`INSERT INTO outbox (
    company_id, id, aggregate_type, aggregate_id, event_type, payload,
    published_at, attempts, next_attempt_at, parked_at, last_error
  ) VALUES (
    ${A.company}, ${event}, 'service_session', ${aggregateId}, 'SessionTipsChanged',
    ${owner.json({ session_id: aggregateId })}, ${new Date('2026-11-01T10:00:00Z')}, 1,
    clock_timestamp(), null, null
  )`;
}

it('CM-24 bootstrap applies the current tip state and marks every revision event', async () => {
  // يثبت أن التهيئة تسقط أحدث مراجعة ببقشيشها وتعلّم أحداث كل المراجعات
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(11), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, sessionId, 2, eventId(12), [tip(A.employee, 'CARD', '20.000')]);
  const result = await bootstrap()(SCOPE);
  expect(result.status).toBe('COMPLETE');
  expect(result.counts).toEqual({ sessions: 1, events: 2 });
  expect(await headOf(sessionId)).toEqual({
    business_id: A.business,
    branch_id: A.branch,
    revision: 2,
    business_date: '2026-12-02',
    period: '2026-12',
  });
  await expectRows(sessionId, [{ employee_id: A.employee, method: 'CARD', amount: '20.000' }]);
  expect(await markedIds()).toEqual([eventId(11), eventId(12)]);
  // إعادة التهيئة نفسها ما بتضيفش ولا رأس ولا صف ولا علامة
  const again = await bootstrap()(SCOPE);
  expect(again.counts).toEqual({ sessions: 1, events: 2 });
  expect(await rowsOf(sessionId)).toHaveLength(1);
  expect(await markedIds()).toHaveLength(2);
});

it('the bootstrapped projection equals the live delivery of the same revision', async () => {
  // يثبت أن إسقاط التهيئة هو نفسه إسقاط المستهلك الحي لنفس المراجعة
  const { ctx, sessionId: bootSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  const { sessionId: liveSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, bootSession, 1, eventId(21), [tip(A.employee, 'CARD', '20.000')]);
  await writeTipRevision(ctx, liveSession, 1, eventId(22), [tip(A.employee, 'CARD', '20.000')]);
  await bootstrap()(SCOPE);
  await deliver(tipEvent(eventId(22), liveSession, 1, [eventTip(A.employee, 'CARD', '20.000')]));
  expect(await headOf(bootSession)).toEqual(await headOf(liveSession));
  expect(await rowsOf(bootSession)).toEqual(await rowsOf(liveSession));
});
it('ignores a stale page and still marks the older events', async () => {
  // يثبت أن صفحة أقدم من المسقطة ما بتغيّرش الرأس ولا الصفوف وبتعلّم أحداثها القديمة
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(31), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, sessionId, 2, eventId(32), [tip(A.employee, 'CARD', '20.000')]);
  await deliver(tipEvent(eventId(33), sessionId, 3, [eventTip(A.employee, 'CARD', '30.000')]));
  await bootstrap((real) => ({
    readPage: async (tx, companyId, businessId, range, page) => {
      const read = await real.readPage(tx, companyId, businessId, range, page);
      return {
        items: read.items.map((item) =>
          item.sessionId === sessionId
            ? { ...item, revision: 1, tips: [tip(A.employee, 'CASH', '10.000')] }
            : item,
        ),
        nextCursor: read.nextCursor,
      };
    },
  }))(SCOPE);
  expect(await revisionOf(sessionId)).toBe(3);
  await expectRows(sessionId, [{ employee_id: A.employee, method: 'CARD', amount: '30.000' }]);
  expect(await markedIds()).toEqual([eventId(31), eventId(32), eventId(33)]);
});
it('a live delivery after the bootstrap changes nothing', async () => {
  // يثبت أن حدثاً مسلَّم بعد التهيئة ما بيعيدش الإسقاط ولا يزيد علامة
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(41), [tip(A.employee, 'CASH', '10.000')]);
  await bootstrap()(SCOPE);
  const head = await headOf(sessionId);
  const rows = await rowsOf(sessionId);
  expect(await markedIds()).toHaveLength(1);
  await deliver(tipEvent(eventId(41), sessionId, 1, [eventTip(A.employee, 'CASH', '10.000')]));
  expect(await headOf(sessionId)).toEqual(head);
  expect(await rowsOf(sessionId)).toEqual(rows);
  expect(await markedIds()).toHaveLength(1);
});
it('CM-24 race: a revision written and delivered between the read and the delivery wins', async () => {
  // يثبت أن المراجعة التي تُكتب وتُسلَّم بين قراءة الصفحة وتسليمها هي الفيصل النهائي
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(51), [tip(A.employee, 'CASH', '10.000')]);
  const result = await bootstrap((real) => ({
    readPage: async (tx, companyId, businessId, range, page) => {
      const read = await real.readPage(tx, companyId, businessId, range, page);
      await writeTipRevision(ctx, sessionId, 2, eventId(52), [tip(A.employee, 'CARD', '20.000')]);
      await deliver(tipEvent(eventId(52), sessionId, 2, [eventTip(A.employee, 'CARD', '20.000')]));
      return read;
    },
  }))(SCOPE);
  expect(result.status).toBe('COMPLETE');
  expect(await revisionOf(sessionId)).toBe(2);
  await expectRows(sessionId, [{ employee_id: A.employee, method: 'CARD', amount: '20.000' }]);
  expect(await markedIds()).toEqual([eventId(51), eventId(52)]);
});
it('CM-24 race: a revision written after the read and delivered later wins', async () => {
  // يثبت أن المراجعة المكتوبة بعد القراءة تسري عند تسليمها لاحقاً بلا إسقاط مكرر
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(61), [tip(A.employee, 'CASH', '10.000')]);
  await bootstrap((real) => ({
    readPage: async (tx, companyId, businessId, range, page) => {
      const read = await real.readPage(tx, companyId, businessId, range, page);
      await writeTipRevision(ctx, sessionId, 2, eventId(62), [tip(A.employee, 'CARD', '20.000')]);
      return read;
    },
  }))(SCOPE);
  expect(await revisionOf(sessionId)).toBe(1);
  expect(await markedIds()).toEqual([eventId(61)]);
  await deliver(tipEvent(eventId(62), sessionId, 2, [eventTip(A.employee, 'CARD', '20.000')]));
  expect(await revisionOf(sessionId)).toBe(2);
  await expectRows(sessionId, [{ employee_id: A.employee, method: 'CARD', amount: '20.000' }]);
  expect(await markedIds()).toEqual([eventId(61), eventId(62)]);
});
it('keeps the head of a session whose latest revision has no tips', async () => {
  // يثبت أن المراجعة الفارغة تترك رأساً بمراجعتها الجديدة بلا صفوف وتُعلّم أحداثها
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(71), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, sessionId, 2, eventId(72), []);
  const result = await bootstrap()(SCOPE);
  expect(result.status).toBe('COMPLETE');
  expect(await revisionOf(sessionId)).toBe(2);
  expect(await rowsOf(sessionId)).toEqual([]);
  expect(await markedIds()).toEqual([eventId(71), eventId(72)]);
});
it('a closed month stays undelivered while the open month is applied', async () => {
  // يثبت أن شهراً معتمداً يمنع إسقاطه ويبقى غير مسلَّم بلا علامات، والشهر المفتوح يُطبَّق
  const ctx = tipCtx(A);
  await walkCommissionStatement(db, { tenant: A, period: '2026-11', ids, to: 'APPROVED' });
  const { sessionId: closedSession } = await seedSession(A, '2026-11-10', CUSTOMER_A);
  const { sessionId: openSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, closedSession, 1, eventId(81), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, openSession, 1, eventId(82), [tip(A.employee, 'CASH', '10.000')]);
  const result = await bootstrap()(SCOPE);
  expect(result.status).toBe('UNDELIVERED');
  expect(result.undelivered).toEqual([
    { sessionId: closedSession, businessId: A.business, code: 'COMMISSION_PERIOD_CLOSED' },
  ]);
  expect(await headOf(closedSession)).toBeUndefined();
  expect(await rowsOf(closedSession)).toEqual([]);
  expect(await markedIds()).toEqual([eventId(82)]);
  expect(await revisionOf(openSession)).toBe(1);
});
it('never touches another company and skips the sessions outside the range', async () => {
  // يثبت عزل التهيئة: شركة B ما بتتلمسش، والنشاط الخطأ ما بيطبّقش، والنطاق بيقصّ الجلسات
  const ctxA = tipCtx(A);
  const ctxB = tipCtx(B);
  const { sessionId: aSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  const { sessionId: bSession } = await seedSession(B, '2026-12-02', CUSTOMER_B);
  const { sessionId: outside } = await seedSession(A, '2026-10-05', CUSTOMER_A);
  await writeTipRevision(ctxA, aSession, 1, eventId(91), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctxB, bSession, 1, eventId(92), [tip(B.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctxA, outside, 1, eventId(93), [tip(A.employee, 'CASH', '10.000')]);
  const result = await bootstrap()(SCOPE);
  expect(result.counts).toEqual({ sessions: 1, events: 1 });
  expect(await revisionOf(aSession)).toBe(1);
  expect(await headOf(bSession)).toBeUndefined();
  expect(await headOf(outside)).toBeUndefined();
  expect(await markedIds()).toEqual([eventId(91)]);
  // نشاط شركة B مع شركة A ما بيطبّقش حاجة
  const crossed = await bootstrap()({
    companyId: A.company,
    businessIds: [B.business],
    from: SCOPE.from,
    to: SCOPE.to,
  });
  expect(crossed.counts).toEqual({ sessions: 0, events: 0 });
  expect(await headOf(bSession)).toBeUndefined();
});
it('never writes outside the projection and the consumption marks', async () => {
  // يثبت أن التهيئة ما بتلمسش صف outbox ولا أعمدته التشغيلية
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(101), [tip(A.employee, 'CASH', '10.000')]);
  await insertOutbox(sessionId, eventId(102));
  const before = await outboxSnapshot(A.company);
  await bootstrap()(SCOPE);
  expect(await outboxSnapshot(A.company)).toEqual(before);
  expect(await rowsOf(sessionId)).toHaveLength(1);
  expect(await markedIds()).toEqual([eventId(101)]);
});
