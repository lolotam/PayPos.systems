import { afterEach, expect, it } from 'vitest';

import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import { FORWARD_VISITS } from '../../modules/customers/domain/rating-claim-scheduling.ts';
import { startBullRunner, type BullRunner } from './rating-claims-bull.fixture.ts';
import {
  at,
  ratingClaimsWorld,
  redisUrl,
  waitForLeaseExpiry,
  type RatingClaimsWorld,
  type RatingClaimsWorldOptions,
} from './rating-claims-world.fixture.ts';

const opened: RatingClaimsWorld[] = [];
const runners: BullRunner[] = [];

afterEach(async () => {
  while (runners.length > 0) await runners.pop()?.close();
  while (opened.length > 0) {
    const world = opened.pop();
    await world?.close();
  }
});

/** بيفتح عالم قبول جديد ويحطه في خانة التنظيف. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  const world = await ratingClaimsWorld(options);
  opened.push(world);
  return world;
}

/** يقفل عالم قبول ويشيله من خانة التنظيف. */
async function closeWorld(world: RatingClaimsWorld): Promise<void> {
  await world.close();
  const index = opened.indexOf(world);
  if (index >= 0) opened.splice(index, 1);
}

/**
 * بيفتح عامل مطالبة على طابور BullMQ حقيقي.
 *
 * العامل بيشغّل الدور الحقيقي من غير ما ناديه بإيدنا، فكل دور بيمشي زي ما بيمشي
 * في الإنتاج: من الطابور، ومع عامل تاني بيتنافس عليه.
 */
async function openRunner(world: RatingClaimsWorld): Promise<BullRunner> {
  const worker = world.worker();
  const runner = await startBullRunner({
    redisUrl,
    prefix: `${world.prefix}:bull`,
    turn: { execute: (companyId) => worker.execute(companyId) },
  });
  runners.push(runner);
  return runner;
}

/** سور من لقطة الحالة، عشان نختبر التعديلات على مستوى الحالة نفسها. */
function fenceOf(
  result: ClaimStateResult<ClaimStateSnapshot>,
  ownerToken: string,
): ClaimStateFence {
  const snapshot = result.value;
  if (snapshot === undefined) throw new Error('RATING_CLAIM_STATE_SNAPSHOT_MISSING');
  return {
    companyId: snapshot.companyId,
    incarnation: snapshot.incarnation,
    expectedVersion: result.version,
    ownerToken,
  };
}

/** رسالة الخطأ اللي وقع في الدور. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** انهيار بعد قراءة الصفحة وقبل تسجيلها: المؤشر ما اتغيّرش ومفيش يوملة. */
async function crashBeforeEnrollment(): Promise<void> {
  const world = await openWorld({ budget: { forward: 3, retry: 1 } });
  const seeded = await world.seedDueRequests({ count: 3 });
  world.tokens.allow = () => true;
  world.state.crashBefore('enrollPage');
  // العامل بيقع جوّه المهمة، فالخطأ بيتسجل فيه بدل ما يطير على الاختبار.
  const crashing = await openRunner(world);
  await crashing.enqueue(world.company);
  expect(crashing.errors.map(errorMessage)).toEqual(['RATING_CLAIM_STATE_CRASH:enrollPage']);
  const crashed = await world.readState();
  expect(crashed.cursorId).toBeUndefined();
  expect(crashed.page).toBeUndefined();
  expect(crashed.phase).toBe('SWEEP');
  // الدور الجاي بيقرأ نفس الصفحة وبيطالب بيها، فمفيش طلب ضايع.
  await crashing.close();
  const taking = await openRunner(world);
  await taking.enqueue(world.company);
  const recovered = await world.readyRequestIds();
  expect(recovered).toHaveLength(3);
  expect(new Set(recovered).size).toBe(3);
  for (const requestId of seeded.requestIds) expect(recovered).toContain(requestId);
  await closeWorld(world);
}

/** انهيار بعد تسجيل الصفحة وقبل المطالبة: اليومية كاملة وبيكمّلها الدور الجاي. */
async function crashAfterEnrollment(): Promise<void> {
  const world = await openWorld({ budget: { forward: 3, retry: 1 }, state: { leaseMs: 1000 } });
  const rows = await world.seedDueRequests({ count: 3 });
  world.tokens.allow = () => true;
  const ownerToken = world.base.ids.newId();
  const acquired = await world.state.port.acquire(
    world.company,
    world.base.ids.newId(),
    ownerToken,
  );
  const fence = fenceOf(acquired, ownerToken);
  const sweepId = world.base.ids.newId();
  const begun = await world.state.port.begin(fence, sweepId, at(rows.requestIds, 2));
  const pageId = world.base.ids.newId();
  const entries = rows.requestIds.map((requestId) => ({
    requestId,
    workToken: world.base.ids.newId(),
  }));
  const enrolled = await world.state.port.enrollPage(
    { ...fence, expectedVersion: begun.version },
    sweepId,
    null,
    pageId,
    entries,
    true,
    FORWARD_VISITS,
  );
  expect(enrolled.code).toBe('OK');
  expect((await world.readState()).page?.entries).toHaveLength(3);
  // العامل الميت لسه ماسك للحالة، فالدور الجاي يستنى انتهاء الحجز وياخدها.
  await waitForLeaseExpiry(world);
  const taking = await openRunner(world);
  await taking.enqueue(world.company);
  const summary = taking.summaries[0];
  expect(summary?.settlements['TERMINAL']).toBe(3);
  const claimed = await world.readyRequestIds();
  expect(claimed).toHaveLength(3);
  expect(new Set(claimed).size).toBe(3);
  await closeWorld(world);
}

/** ضياع رد التسجيل: التنفيذ حصل والعميل ما عرفش، فالمطابقة بصفحة الجولة بتلحق. */
async function loseEnrollmentReply(): Promise<void> {
  const world = await openWorld({ budget: { forward: 3, retry: 1 }, state: { leaseMs: 1000 } });
  const rows = await world.seedDueRequests({ count: 3 });
  world.tokens.allow = () => true;
  world.state.loseReply('enrollPage');
  const losing = await openRunner(world);
  await losing.enqueue(world.company);
  expect(losing.errors.map(errorMessage)).toEqual(['RATING_CLAIM_STATE_REPLY_LOST:enrollPage']);
  const enrolled = await world.readState();
  expect(enrolled.page?.entries).toHaveLength(3);
  expect(await world.readyRequestIds()).toHaveLength(0);
  // العامل الميت ما سابش الحجز، فالدور الجاي يستنى انتهاءه ويكمّل اليومية.
  await losing.close();
  await waitForLeaseExpiry(world);
  const taking = await openRunner(world);
  await taking.enqueue(world.company);
  const ready = await world.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  for (const requestId of rows.requestIds) expect(ready).toContain(requestId);
  await closeWorld(world);
}

it('crash_before_page_enrollment', async () => {
  await crashBeforeEnrollment();
}, 300_000);

it('crash_after_page_enrollment', async () => {
  await crashAfterEnrollment();
}, 300_000);

it('a_lost_enrollment_reply_is_reconciled_by_the_next_turn', async () => {
  await loseEnrollmentReply();
}, 300_000);

it('a_rolled_back_claim_leaves_no_trace_and_the_next_turn_claims_it_once', async () => {
  const w = await openWorld({ budget: { forward: 4, retry: 1 }, state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 4 });
  const rolledBack = at(seeded.requestIds, 0);
  w.tokens.allow = () => true;
  // الخطّاف بيقع بعد المطالبة جوّه المعاملة: تحديث الحالة والحدث اتكتبوا فعلاً،
  // وبعدين رجعوا كلهم لحد ما الداتابيز ترفض المعاملة.
  w.claimTrap.failAfter.add(rolledBack);
  const first = await openRunner(w);
  await first.enqueue(w.company);
  const afterFirst = await w.readState();
  expect(afterFirst.retries[rolledBack]).toBeDefined();
  expect((await w.requestStatuses()).get(rolledBack)).toBe('SCHEDULED');
  const ready = await w.readyRequestIds();
  expect(ready.filter((id) => id === rolledBack)).toHaveLength(0);
  // الخطّاف اتشال، فالدور الجاي بيطالب بالطلب من خريطة الإعادة ويكتب المطالبة مرة واحدة.
  w.claimTrap.failAfter.delete(rolledBack);
  await first.enqueue(w.company);
  expect((await w.requestStatuses()).get(rolledBack)).toBe('SENDING');
  const afterSecond = await w.readyRequestIds();
  expect(afterSecond.filter((id) => id === rolledBack)).toHaveLength(1);
}, 300_000);

it('an_uncertain_commit_keeps_the_row_sending_without_a_second_claim', async () => {
  const w = await openWorld({ budget: { forward: 4, retry: 1 }, state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 4 });
  const uncertain = at(seeded.requestIds, 1);
  w.tokens.allow = () => true;
  // الـ commit بيتم، بس الرد بيضيع، فالدور مالوش idea إن المطالبة نجحت.
  w.txTrap.lostReplies.add(uncertain);
  const first = await openRunner(w);
  await first.enqueue(w.company);
  expect(w.diagnostics.failures.map(errorMessage)).toEqual(['RATING_CLAIM_COMMIT_REPLY_LOST']);
  expect((await w.requestStatuses()).get(uncertain)).toBe('SENDING');
  const ready = await w.readyRequestIds();
  expect(ready.filter((id) => id === uncertain)).toHaveLength(1);
  // عدم اليقين مرة واحدة بس: الدور الجاي بيشوف السطر نفسه وما بيطلبش تاني.
  w.txTrap.lostReplies.delete(uncertain);
  await first.enqueue(w.company);
  const afterSecond = await w.readyRequestIds();
  expect(afterSecond.filter((id) => id === uncertain)).toHaveLength(1);
  expect((await w.requestStatuses()).get(uncertain)).toBe('SENDING');
}, 300_000);

it('a_lost_settlement_reply_keeps_the_request_in_the_retry_map', async () => {
  const w = await openWorld({ budget: { forward: 4, retry: 1 }, state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 4 });
  const rolledBack = at(seeded.requestIds, 0);
  w.tokens.allow = () => true;
  w.claimTrap.failAfter.add(rolledBack);
  const first = await openRunner(w);
  await first.enqueue(w.company);
  expect((await w.readState()).retries[rolledBack]).toBeDefined();
  // ضياع رد الإقرار: التسوية اتنفّذت والعميل ما عرفش، فالطلب ما يتشالش.
  w.state.loseReply('settleRetry');
  await first.enqueue(w.company);
  expect(first.errors.map(errorMessage)).toEqual(['RATING_CLAIM_STATE_REPLY_LOST:settleRetry']);
  const afterLost = await w.readState();
  expect(afterLost.retries[rolledBack]).toBeDefined();
  expect(await w.readyRequestIds()).toHaveLength(3);
  // الدور اللي بعده بياخد الشغل المعلّق ويكمّله، بس الطلب الفاشل يفضل في الخريطة.
  await first.close();
  await waitForLeaseExpiry(w);
  const taking = await openRunner(w);
  await taking.enqueue(w.company);
  const finished = await w.readState();
  expect(finished.retries[rolledBack]).toBeDefined();
  const finalReady = await w.readyRequestIds();
  expect(finalReady).toHaveLength(3);
  expect(finalReady.filter((id) => id === rolledBack)).toHaveLength(0);
}, 300_000);
