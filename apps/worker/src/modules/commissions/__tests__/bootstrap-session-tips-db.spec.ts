import { expect, it } from 'vitest';

import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  A,
  B,
  CUSTOMER_A,
  CUSTOMER_B,
  SCOPE,
  bootstrap,
  db,
  deliver,
  eventId,
  eventTip,
  expectRows,
  headOf,
  ids,
  insertOutbox,
  markedIds,
  outboxSnapshot,
  revisionOf,
  rowsOf,
  seedSession,
  tip,
  tipCtx,
  tipEvent,
  useBootstrapHarness,
  writeTipRevision,
} from './bootstrap-session-tips-db.harness.ts';

useBootstrapHarness();

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
  // إعادة التهيئة نفسها ما بتضيفش ولا رأس ولا صف ولا علامة، والعلامة القديمة ما تتحسبش جديداً
  const again = await bootstrap()(SCOPE);
  expect(again.counts).toEqual({ sessions: 1, events: 0 });
  expect(await rowsOf(sessionId)).toHaveLength(1);
  expect(await markedIds()).toHaveLength(2);
});

it('the bootstrapped projection equals the live delivery of the same revision', async () => {
  // يثبت أن إسقاط التهيئة هو نفسه إسقاط المستهلك الحي لنفس المراجعة
  const { ctx, sessionId: bootSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, bootSession, 1, eventId(21), [tip(A.employee, 'CARD', '20.000')]);
  await bootstrap()(SCOPE);
  // الزيارة الحية بتُكتب بعد التهيئة، فالتهيئة ما شافتش حدثها وما علّمتهوش؛التسليم الحي هو اللي طبّقها
  const { sessionId: liveSession } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, liveSession, 1, eventId(22), [tip(A.employee, 'CARD', '20.000')]);
  await deliver(tipEvent(eventId(22), liveSession, 1, [eventTip(A.employee, 'CARD', '20.000')]));
  expect(await headOf(liveSession)).toBeDefined();
  expect(await markedIds()).toEqual([eventId(21), eventId(22)]);
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
