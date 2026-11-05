// الحجز والسقف: الدور بيوقّف نفسه لما وقتو يخلص، والتجديد بيمدّد حجوزات
// الإعادة بتاعت المالك نفسه وبس.
import { afterEach, expect, it } from 'vitest';

import { FORWARD_VISITS } from '../../modules/customers/domain/rating-claim-scheduling.ts';
import { fenceOf } from './rating-claims-fencing.fixture.ts';
import { tracedState } from './rating-claims-trace.fixture.ts';
import {
  at,
  ratingClaimsWorld,
  type RatingClaimsWorld,
  type RatingClaimsWorldOptions,
} from './rating-claims-world.fixture.ts';

let world: RatingClaimsWorld | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** بيفتح عالم قبول جديد. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  world = await ratingClaimsWorld(options);
  return world;
}

/** مفتاح حالة الشركة في Redis. */
function stateKey(w: RatingClaimsWorld): string {
  return `${w.prefix}:rating-claims:v1:{${w.company}}:state`;
}

/** وقت Redis الحالي بالمللي ثانية؛ الحجز بيتقاس بوقت Redis مش بساعة الجهاز. */
async function serverNowMs(w: RatingClaimsWorld): Promise<number> {
  const [seconds, micros] = await w.redis.time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}

/** ينتظر وقت Redis يعدّي لحظة معيّنة، من غير نوم ثابت. */
async function waitUntil(w: RatingClaimsWorld, target: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if ((await serverNowMs(w)) >= target) return;
    if (Date.now() > deadline) throw new Error('RATING_CLAIM_SERVER_TIME_NOT_REACHED');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * مدخل إعادة بمالك تاني، بيتكتب في الحالة مباشرة.
 *
 * المالك التاني مش موجود عندنا في الاختبار، والهدف إننا نتأكد إن التجديد
 * بيمدّد حجوزات المالك نفسه وبس.
 *
 * @param w عالم القبول
 * @param requestId معرّف المدخل المزروع
 * @param leaseUntil نهاية الحجز المزروع
 */
async function addForeignRetryEntry(
  w: RatingClaimsWorld,
  requestId: string,
  leaseUntil: number,
): Promise<void> {
  const key = stateKey(w);
  const raw = await w.redis.get(key);
  if (raw === null) throw new Error('RATING_CLAIM_STATE_MISSING');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('RATING_CLAIM_STATE_CRAFT_INVALID');
  const state = parsed as Record<string, unknown>;
  const retries = state['retries'];
  if (typeof retries !== 'object' || retries === null)
    throw new Error('RATING_CLAIM_STATE_CRAFT_INVALID');
  (retries as Record<string, unknown>)[requestId] = {
    eligibleAt: 0,
    ticket: 999,
    workToken: 'foreign-work-token',
    ownerToken: 'foreign-owner-token',
    leaseUntil,
  };
  await w.redis.set(key, JSON.stringify(state));
}

/**
 * ينتظر لحد ما الدور يستلم الحالة، ويجيب لحظة استلامه.
 *
 * السقف بيتحسب من لحظة استلام الدور هو، فمفيش فايدة نستنى على لحظة حد تانية.
 *
 * @param w عالم القبول
 * @param previousStartedAt لحظة الاستلام اللي قبل الدور
 * @param previousOwner رمز المالك اللي قبل الدور
 * @returns لحظة استلام الدور بالمللي ثانية
 */
async function waitForTurnAcquisition(
  w: RatingClaimsWorld,
  previousStartedAt: number,
  previousOwner: string,
): Promise<number> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const snapshot = await w.readState();
    const startedAt = snapshot.turnStartedAt ?? 0;
    if (startedAt > previousStartedAt && snapshot.ownerToken !== previousOwner) return startedAt;
    if (Date.now() > deadline) throw new Error('RATING_CLAIM_TURN_ACQUIRE_NOT_SEEN');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it('the_turn_stops_at_its_ceiling_instead_of_losing_its_fence', async () => {
  // الحجز أقصر من سقف الدور: التجديد ممكن يضمن حجز كامل قبل السقف، ولما وقت
  // الدور يخلص التجديد بيرجع LIMIT والدور يوقّف نفسه بنفسه.
  const leaseMs = 3_000;
  const maxTurnMs = 4_000;
  const w = await openWorld({ state: { leaseMs, maxTurnMs } });
  const seeded = await w.seedDueRequests({ count: 3 });
  w.tokens.allow = () => true;

  // تجديد قبل السقف: بيعدّي وبيمدّد الحجز.
  const ownerToken = w.base.ids.newId();
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  const before = await w.readState();
  const leaseBefore = before.leaseUntil ?? 0;
  const renewed = await w.state.port.renew(fence);
  expect(renewed.code).toBe('OK');
  const afterRenew = await w.readState();
  expect(afterRenew.leaseUntil ?? 0).toBeGreaterThan(leaseBefore);
  // الحالة رجعت للغير ممسوكة، فالدور الجاي ياخدها بسقف جديد.
  await w.state.port.release({ ...fence, expectedVersion: renewed.version });

  // بنوقف الدور عند تسوية البند الأول: المطالبة اتعملت وات-commitت، والتسوية
  // مستنية. قفل العميل مش بيعمل هنا، لأن معاملة المستأجر محدودة بـ lock_timeout.
  const state = tracedState(w.rawState);
  const gate = state.hold('settlePage');
  const turn = w.worker({ state: state.port });
  w.claimTrap.clockJumpMs = 31_000;
  const pending = turn.execute(w.company);
  await gate.acquired;
  // السقف من لحظة استلام الدور نفسه: التسوية بتخلص بعد ١٫٥ ثانية من الاستلام،
  // فالحجز (٣ ثواني) لسه صالح، والتجديد اللي بعدها يقع بعد حدّ السقف (٤ ثواني)
  // فيرجع LIMIT بهامش نص ثانية.
  const turnStartedAt = await waitForTurnAcquisition(w, before.turnStartedAt ?? 0, ownerToken);
  await waitUntil(w, turnStartedAt + maxTurnMs - leaseMs + 500);
  gate.release();
  const first = await pending;
  expect(first.end).toBe('LIMIT_REACHED');
  // البند الأول اتطالب، والتاني ما اتطالبش: مفيش مطالبة بدأت بعد السقف.
  expect(first.forwardVisits).toBe(1);
  expect(first.settlements['TERMINAL']).toBe(1);
  expect(w.diagnostics.fenceLosses).toHaveLength(0);
  const readyAfterFirst = await w.readyRequestIds();
  expect(readyAfterFirst).toEqual([at(seeded.requestIds, 0)]);
  // المجلة لسه مسجّلة، فالدور الجاي بيكملها.
  const afterFirst = await w.readState();
  expect(afterFirst.page?.entries).toHaveLength(2);
  const second = await w.turn();
  expect(second.end).toBe('COMPLETED');
  expect(second.forwardVisits).toBe(2);
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  for (const requestId of seeded.requestIds) expect(ready).toContain(requestId);
}, 120_000);

it('renew_extends_only_the_retry_leases_of_the_same_owner', async () => {
  const w = await openWorld({ state: { leaseMs: 3_000 } });
  const requestId = w.base.ids.newId();
  const foreignId = w.base.ids.newId();
  const ownerToken = w.base.ids.newId();
  const startedAt = await serverNowMs(w);
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  // صفحة فيها الطلب، وتسوية retry بتخليه في خريطة الإعادة.
  const sweepId = w.base.ids.newId();
  const pageId = w.base.ids.newId();
  const workToken = w.base.ids.newId();
  const begun = await w.state.port.begin(fence, sweepId, requestId);
  expect(begun.code).toBe('OK');
  const afterBegin = { ...fence, expectedVersion: begun.version };
  const enrolled = await w.state.port.enrollPage(
    afterBegin,
    sweepId,
    null,
    pageId,
    [{ requestId, workToken }],
    true,
    FORWARD_VISITS,
  );
  expect(enrolled.code).toBe('OK');
  const afterEnroll = { ...afterBegin, expectedVersion: enrolled.version };
  const settled = await w.state.port.settlePage(afterEnroll, pageId, workToken, 'RETRY');
  expect(settled.code).toBe('OK');
  const afterSettle = { ...afterEnroll, expectedVersion: settled.version };
  // الحجز: الطلب بيتحجز للمالك برمز شغل، وحجوزته بتتقفل مع حجز المالك.
  const reservationToken = w.base.ids.newId();
  const reserved = await w.state.port.reserveRetries(afterSettle, 1, [reservationToken]);
  expect(reserved.code).toBe('OK');
  const before = await w.readState();
  const leaseBefore = before.retries[requestId]?.leaseUntil;
  expect(leaseBefore).toBeDefined();
  await addForeignRetryEntry(w, foreignId, 1);
  // التجديد بيحصل قبل ما حجز المالك ينتهي، وبعدين ننتظر لحد ما الحجز القديم يخلص.
  await waitUntil(w, startedAt + 2_000);
  const renewed = await w.state.port.renew({
    ...afterSettle,
    expectedVersion: reserved.version,
  });
  expect(renewed.code).toBe('OK');
  const after = await w.readState();
  expect(after.retries[requestId]?.leaseUntil).toBeGreaterThan(leaseBefore ?? 0);
  // مدخل المالك التاني ما اتمدّدش.
  expect(after.retries[foreignId]?.leaseUntil).toBe(1);
  // الحجز القديم كان خلص، والتسوية بتنجح لأن التجديد مدّدها.
  await waitUntil(w, (leaseBefore ?? 0) + 1);
  const settledRetry = await w.state.port.settleRetry(
    { ...afterSettle, expectedVersion: renewed.version },
    requestId,
    reservationToken,
    'TERMINAL',
  );
  expect(settledRetry.code).toBe('OK');
}, 120_000);
