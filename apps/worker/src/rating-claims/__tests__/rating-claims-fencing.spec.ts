import { afterEach, expect, it } from 'vitest';

import { FORWARD_VISITS } from '../../modules/customers/domain/rating-claim-scheduling.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import { startBullRunner, type BullRunner } from './rating-claims-bull.fixture.ts';
import {
  enrollAndReserve,
  expectEveryCommandStale,
  expectTenantIsolation,
  fenceOf,
  seedCompanyBRows,
  stateKey,
} from './rating-claims-fencing.fixture.ts';
import {
  at,
  ratingClaimsWorld,
  redisUrl,
  waitForLeaseExpiry,
  type RatingClaimsWorld,
  type RatingClaimsWorldOptions,
} from './rating-claims-world.fixture.ts';
import { tracedState, type TracedState } from './rating-claims-trace.fixture.ts';

let world: RatingClaimsWorld | undefined;
const runners: BullRunner[] = [];

afterEach(async () => {
  while (runners.length > 0) await runners.pop()?.close();
  await world?.close();
  world = undefined;
});

/** بيفتح عالم قبول جديد ويحطه في خانة التنظيف. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  world = await ratingClaimsWorld(options);
  return world;
}

/**
 * عاملان BullMQ حقيقيان على طابور واحد، بيتنافسوا على نفس الدور.
 *
 * العامل A بياخد المهمة الأولى وبيتوقف في تسوية الصفحة، فبيضل ماسك للحالة؛ وبعد ما
 * الحجز ينتهي العامل B بياخد المهمة التانية ويمشي قدام، وهو واقف في التسوية كمان.
 * الاتنين واقفين، فالحالة في إيد B وصفحة A لسه مسجّلة جواهها.
 */
async function runTwoBullWorkers(w: RatingClaimsWorld): Promise<{
  readonly runnerA: BullRunner;
  readonly runnerB: BullRunner;
  readonly aState: TracedState;
  readonly releaseAll: () => void;
  readonly waitAll: () => Promise<void>;
}> {
  const aState = tracedState(w.rawState);
  const bState = tracedState(w.rawState);
  const aGate = aState.hold('settlePage');
  const bGate = bState.hold('settlePage');
  const workerA = w.worker({ state: aState.port });
  const workerB = w.worker({ state: bState.port });
  const prefix = `${w.prefix}:bull`;
  const runnerA = await startBullRunner({
    redisUrl,
    prefix,
    turn: { execute: (companyId) => workerA.execute(companyId) },
  });
  runners.push(runnerA);
  const heldA = runnerA.enqueue(w.company);
  await aGate.acquired;
  await waitForLeaseExpiry(w);
  const runnerB = await startBullRunner({
    redisUrl,
    prefix,
    turn: { execute: (companyId) => workerB.execute(companyId) },
  });
  runners.push(runnerB);
  const heldB = runnerB.enqueue(w.company);
  await bGate.acquired;
  return {
    runnerA,
    runnerB,
    aState,
    releaseAll: () => {
      aGate.release();
      bGate.release();
    },
    waitAll: async () => {
      await heldA;
      await heldB;
    },
  };
}

it('two_workers_expired_owner_cannot_regress_state', async () => {
  const w = await openWorld({ state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 3 });
  w.tokens.allow = () => true;
  // العامل A بيتوقف في تسوية الصفحة، فبيضل ماسك للحالة؛ وB يكمّل بعد انتهاء الحجز.
  const { runnerA, runnerB, aState, releaseAll, waitAll } = await runTwoBullWorkers(w);
  const key = stateKey(w.prefix, w.company);
  // الحالة كما هي بعد ما B أخذها: لقطة البايتات كاملة، عشان نقارن بعد كل رفض.
  const snapshot = await w.redis.get(key);
  expect(snapshot).not.toBeNull();
  // سور A القديم: نفس الصفحة ونفس رمز الشغل اللي في الحالة، فالفرق الوحيد هو السور.
  const staleCalls = aState.trace.calls.filter((call) => call.method === 'settlePage');
  const staleFence = at(staleCalls, 0).fence;
  const stalePage = at(aState.trace.pages, 0);
  const staleWorkToken = at(stalePage.workTokens, 0);
  const staleSettlement = await w.state.port.settlePage(
    staleFence,
    stalePage.pageId,
    staleWorkToken,
    'RETRY',
  );
  expect(staleSettlement.code).toBe('STALE');
  expect(await w.redis.get(key)).toBe(snapshot);
  const staleRenew = await w.state.port.renew(staleFence);
  expect(staleRenew.code).toBe('STALE');
  expect(await w.redis.get(key)).toBe(snapshot);
  const staleRelease = await w.state.port.release(staleFence);
  expect(staleRelease.code).toBe('STALE');
  expect(await w.redis.get(key)).toBe(snapshot);
  // الاتنين بيكملوا: B بيسوّي الصفحة، وA بيفشل بسور قديم.
  releaseAll();
  await waitAll();
  expect(runnerB.summaries[0]?.end).toBe('COMPLETED');
  expect(runnerA.summaries[0]?.end).toBe('FENCE_LOST');
  expect(w.diagnostics.fenceLosses).toContain('STALE');
  // كل طلب ناجح له حدث واحد بس، ومفيش تكرار من دور A.
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  for (const requestId of seeded.requestIds) expect(ready).toContain(requestId);
}, 120_000);

it('recreated_state_rejects_all_old_fences', async () => {
  const w = await openWorld();
  const seeded = await w.seedDueRequests({ count: 3 });
  const requestId = at(seeded.requestIds, 0);
  // حالة الشركة التانية موجودة، والحذف لازم ما يمسّهاش.
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(w.otherCompany, w.base.ids.newId(), otherOwner);
  expect(otherAcquired.code).toBe('OK');
  const otherFence = fenceOf(otherAcquired, otherOwner);
  // العامل A ياخد الحالة ويسجل صفحة فيها شغل، ويحجز تذكرة إعادة لنفس الطلب.
  const ownerA = w.base.ids.newId();
  const acquiredA = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerA);
  const sweepId = w.base.ids.newId();
  const pageId = w.base.ids.newId();
  const workToken = w.base.ids.newId();
  const reservationToken = w.base.ids.newId();
  const oldFence = await enrollAndReserve(
    w,
    fenceOf(acquiredA, ownerA),
    sweepId,
    pageId,
    requestId,
    workToken,
    reservationToken,
  );
  // حذف حالة الشركة المختبرة بس.
  await w.redis.del(stateKey(w.prefix, w.company));
  // العامل B يعمل الحالة من جديد: نسخة جديدة بنفس الرقم، وبنفس الصفحة والتذكرة.
  const ownerB = w.base.ids.newId();
  const acquiredB = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerB);
  expect(acquiredB.code).toBe('OK');
  expect(acquiredB.version).toBe(1);
  expect(acquiredB.value?.incarnation).not.toBe(oldFence.incarnation);
  const newFence = await enrollAndReserve(
    w,
    fenceOf(acquiredB, ownerB),
    sweepId,
    pageId,
    requestId,
    workToken,
    reservationToken,
  );
  // الدليل على النسخة مش على الرقم: نفس رقم النسخة، بس نسخة A القديمة.
  expect(newFence.expectedVersion).toBe(oldFence.expectedVersion);
  // سور A مرفوض على كل حاجة، حتى إقرار الإعادة: الصفحة والتذكرة موجودين فعلاً.
  await expectEveryCommandStale(
    w.state.port,
    oldFence,
    pageId,
    workToken,
    requestId,
    reservationToken,
  );
  // حالة B ما اتغيرتش، وحالة الشركة التانية ما اتمسحتش.
  const afterB = await w.state.port.read(w.company);
  expect(afterB.value?.incarnation).toBe(acquiredB.value?.incarnation);
  expect(afterB.version).toBe(newFence.expectedVersion);
  const otherAfter = await w.state.port.read(w.otherCompany);
  expect(otherAfter.value?.incarnation).toBe(otherFence.incarnation);
}, 120_000);

it('locked_page_candidate_is_enrolled', async () => {
  const w = await openWorld({ budget: { forward: 3, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 3 });
  w.tokens.allow = () => true;
  const blocked = at(seeded.requestIds, 1);
  const lock = await w.holdRequestLock(blocked);
  const summary = await w.turn();
  // الاكتشاف تضمّن المعرّف المقفول، والمطالبة اتخطّت بسبب القفل.
  const enrolled = w.state.trace.pages.flatMap((page) => page.requestIds);
  expect(enrolled).toContain(blocked);
  expect(summary.settlements['RETRY']).toBe(1);
  const statuses = await w.requestStatuses();
  expect(statuses.get(blocked)).toBe('SCHEDULED');
  expect(statuses.get(at(seeded.requestIds, 0))).toBe('SENDING');
  const afterFirst = await w.readState();
  expect(afterFirst.retries[blocked]).toBeDefined();
  expect(await w.readyRequestIds()).toHaveLength(2);
  // القفل بينتهى، فالمطالبة بتكمّل وبتطلع event واحد بس.
  lock.release();
  await lock.done;
  await w.turn();
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  expect(ready).toContain(blocked);
  expect((await w.requestStatuses()).get(blocked)).toBe('SENDING');
}, 120_000);

it('a_missing_state_ends_the_turn_and_records_the_fence_loss', async () => {
  const w = await openWorld();
  const seeded = await w.seedDueRequests({ count: 1 });
  w.tokens.allow = () => true;
  const state = tracedState(w.rawState);
  const gate = state.hold('settlePage');
  const turn = w.worker({ state: state.port });
  const pending = turn.execute(w.company);
  await gate.acquired;
  // المفتاح اختفى في نص الدور، فالرد بيرجع MISSING.
  await w.redis.del(stateKey(w.prefix, w.company));
  gate.release();
  const summary = await pending;
  expect(summary.end).toBe('FENCE_LOST');
  // فقد السور اتسجّل بنوعه: من غير كده الشكل ده بيبان كأنه ضياع رد عادي.
  expect(w.diagnostics.fenceLosses).toEqual(['MISSING']);
  // المطالبة كانت اتعملت قبل ما المفتاح يختفي، فالطلب المزروع هو اللي اتجهّز.
  const ready = await w.readyRequestIds();
  expect(ready).toEqual([at(seeded.requestIds, 0)]);
}, 120_000);

it('tenant_isolation_covers_state_and_claims', async () => {
  const w = await openWorld({ budget: { forward: 3, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 2 });
  const shared = at(seeded.requestIds, 0);
  const bOnly = await seedCompanyBRows(w, shared);
  const ownerToken = w.base.ids.newId();
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(w.otherCompany, w.base.ids.newId(), otherOwner);
  expect(otherAcquired.code).toBe('OK');
  // مفاتيح الحالة مختلفة، لأن المفتاح فيه الشركة، والاتنين اتكتبوا فعلاً.
  const keyA = stateKey(w.prefix, w.company);
  const keyB = stateKey(w.prefix, w.otherCompany);
  expect(keyA).not.toBe(keyB);
  expect(await w.redis.exists(keyA)).toBe(1);
  expect(await w.redis.exists(keyB)).toBe(1);
  // سور الشركة الأولى مرفوض على حالة الشركة التانية، والصفحة موجودة هناك فعلاً:
  // الفرق الوحيد هو السور.
  const otherFence = fenceOf(otherAcquired, otherOwner);
  const otherSweepId = w.base.ids.newId();
  const otherPageId = w.base.ids.newId();
  const otherWorkToken = w.base.ids.newId();
  const otherBegun = await w.state.port.begin(otherFence, otherSweepId, shared);
  const otherEnrolled = await w.state.port.enrollPage(
    { ...otherFence, expectedVersion: otherBegun.version },
    otherSweepId,
    null,
    otherPageId,
    [{ requestId: shared, workToken: otherWorkToken }],
    true,
    FORWARD_VISITS,
  );
  expect(otherEnrolled.code).toBe('OK');
  const crossed = await w.state.port.settlePage(
    { ...fence, companyId: w.otherCompany },
    otherPageId,
    otherWorkToken,
    'RETRY',
  );
  expect(crossed.code).toBe('STALE');
  // سور الشركة الأولى اتسلّم، عشان الدور ياخد ملكية الحالة: من غير كده الجولة بترجع
  // تاني من غير ما تاخد الحالة، فما بتطلعش أي مطالبة.
  const releasedA = await w.state.port.release(fence);
  expect(releasedA.code).toBe('OK');
  // سور الشركة التانية اتسلّم كمان، عشان التنظيف يبقى واضح: الدور بيلمس الشركة الأولى بس.
  const releasedB = await w.state.port.release({
    ...otherFence,
    expectedVersion: otherEnrolled.version,
  });
  expect(releasedB.code).toBe('OK');
  // البصمة مفتوحة، عشان المطالبة تنجح فعلاً: من غير كده ما فيش أي حدث، فيبقى العزل
  // صحيح بالفراغ مش لأن الشركة التانية اتفصلت.
  w.tokens.allow = () => true;
  // دور الشركة الأولى ما بيقراش ولا بيكتبش ولا يطلعش أحداث للشركة التانية.
  await w.turn();
  // أحداث الشركة الأولى اتطبع فعلاً، فصفر أحداث الشركة التانية مش نتيجة صمت.
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(seeded.requestIds.length);
  for (const requestId of seeded.requestIds) expect(ready).toContain(requestId);
  await expectTenantIsolation(w, bOnly);
  // والشركة الأولى بتقر صفها هي عادي: العزل بيمنع الصف التاني بس.
  const aRow = await w.base.db.withTenant(w.company, async (tx) =>
    ratingClaimRepository.findRequest(tx, w.company, shared),
  );
  expect(aRow?.customerId).toBe(at(seeded.customerIds, 0));
  const bEvents = await w.base.owner`SELECT count(*)::int AS total FROM outbox
    WHERE company_id = ${w.otherCompany} AND event_type = 'RatingRequestReady'`;
  expect(Number(bEvents[0]?.['total'])).toBe(0);
}, 120_000);
