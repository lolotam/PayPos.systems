import { markEventConsumed } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

import { COMMISSION_INPUTS_CONSUMER_ID } from '../index.ts';
import {
  A,
  CUSTOMER_A,
  SCOPE,
  bootstrap,
  db,
  eventId,
  headOf,
  markedIds,
  owner,
  seedSession,
  tip,
  useBootstrapHarness,
  writeTipRevision,
  type BootstrapResult,
} from './bootstrap-session-tips-db.harness.ts';

useBootstrapHarness();

/** بوابة تُفتح مرة واحدة، فالمعاملة المحتجزة تتنفّذ عند فتحها. */
const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};
/** إشارة تُطلق مرة واحدة فتخبر الاختبار أن خطوة داخل معاملة حيّة تمّت. */
const signal = () => {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};
/** قفل الجلسة نفسه في المسار الحي؛ التهيئة لازم تاخده بعد الحسم لا قبله. */
const sessionLock = (sessionId: string) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(
    app_company_id()::text || ':commission-tip-session:' || ${sessionId}::uuid::text, 0))`;
/** ينتظر ظهور رأس زيارة من اتصال المالك، وظهوره يثبت أن معاملتها انتهت. */
const waitForHead = async (sessionId: string): Promise<void> => {
  const started = Date.now();
  for (;;) {
    const rows = await owner`SELECT session_id FROM commission_tip_heads WHERE session_id=${sessionId}`;
    if (rows.length > 0) return;
    if (Date.now() - started > 10_000) throw new Error('SESSION_TIPS_BOOTSTRAP_HEAD_MISSING');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
/**
 * ينتظر ظهور قفل غير ممنوح، أي انتظار معاملة على معاملة حيّة، بحد عشر ثوانٍ ودون عشوائية.
 * عدّ الأقفال غير الممنوحة يكشف الانتظار بلا قراءة نصوص أوامر الآخرين، والنص نفسه غير مطلوب.
 */
const waitForBlockedLock = async (): Promise<void> => {
  const started = Date.now();
  for (;;) {
    const [row] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`;
    if ((row?.n ?? 0) >= 1) return;
    if (Date.now() - started > 10_000) throw new Error('SESSION_TIPS_BOOTSTRAP_LOCK_NOT_WAITING');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

it('CM-24 lock order: the bootstrap claims the event before it locks the session', async () => {
  // يثبت أن التهيئة تحسم الحدث قبل قفل الجلسة، فلا تتجمّد أمام حسم حي غير مثبَّت
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  const event = await writeTipRevision(ctx, sessionId, 1, eventId(201), [
    tip(A.employee, 'CASH', '10.000'),
  ]);
  const release = gate();
  const claimed = signal();
  let live: Promise<unknown> | undefined;
  let run: Promise<BootstrapResult> | undefined;
  try {
    live = db.withTenant(A.company, async (tx) => {
      await markEventConsumed(tx, COMMISSION_INPUTS_CONSUMER_ID, event);
      claimed.open();
      await release.promise;
      await tx.execute(sessionLock(sessionId));
    });
    await claimed.promise;
    run = bootstrap()(SCOPE);
    await waitForBlockedLock();
    release.open();
    await live;
    const result = await run;
    expect(result.status).toBe('COMPLETE');
    expect(result.counts).toEqual({ sessions: 1, events: 0 });
    expect(await headOf(sessionId)).toMatchObject({
      business_id: A.business,
      branch_id: A.branch,
      revision: 1,
      business_date: '2026-12-02',
      period: '2026-12',
    });
    expect(await markedIds()).toEqual([event]);
  } finally {
    release.open();
    await live?.catch(() => undefined);
    await run?.catch(() => undefined);
  }
});
it('CM-24 lock release: a visit releases its locks before the next visit starts', async () => {
  // يثبت أن أقفال الزيارة تُترك مع ثبوتها، فالزيارة التالية تبدأ ولا تنتظر معاملة الصفحة
  const first = await seedSession(A, '2026-12-01', CUSTOMER_A);
  const second = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(first.ctx, first.sessionId, 1, eventId(211), [
    tip(A.employee, 'CASH', '10.000'),
  ]);
  await writeTipRevision(second.ctx, second.sessionId, 1, eventId(212), [
    tip(A.employee, 'CASH', '10.000'),
  ]);
  const release = gate();
  const claimed = signal();
  let live: Promise<unknown> | undefined;
  let run: Promise<BootstrapResult> | undefined;
  let settled = false;
  try {
    live = db.withTenant(A.company, async (tx) => {
      await tx.execute(sessionLock(second.sessionId));
      claimed.open();
      await release.promise;
    });
    await claimed.promise;
    run = bootstrap()(SCOPE).then((result) => {
      settled = true;
      return result;
    });
    await waitForHead(first.sessionId);
    expect(settled).toBe(false);
    expect(await headOf(second.sessionId)).toBeUndefined();
    release.open();
    await live;
    const result = await run;
    expect(result.status).toBe('COMPLETE');
    expect(result.counts).toEqual({ sessions: 2, events: 2 });
    expect(await headOf(first.sessionId)).toMatchObject({
      business_id: A.business,
      branch_id: A.branch,
      revision: 1,
      business_date: '2026-12-01',
      period: '2026-12',
    });
    expect(await headOf(second.sessionId)).toMatchObject({
      business_id: A.business,
      branch_id: A.branch,
      revision: 1,
      business_date: '2026-12-02',
      period: '2026-12',
    });
    expect(await markedIds()).toEqual([eventId(211), eventId(212)]);
  } finally {
    release.open();
    await live?.catch(() => undefined);
    await run?.catch(() => undefined);
  }
});
