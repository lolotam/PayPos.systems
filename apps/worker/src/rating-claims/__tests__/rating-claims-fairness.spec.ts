import { afterEach, expect, it } from 'vitest';

import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
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

/** بيفتح عالم قبول جديد ويحطه في خانة التنضيف. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  world = await ratingClaimsWorld(options);
  return world;
}

/** عدد الطلبات اللي في خريطة الإعادة. */
function retryCount(snapshot: ClaimStateSnapshot): number {
  return Object.keys(snapshot.retries).length;
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

it('retained_1200_reaches_tail_without_epoch_reset', async () => {
  const w = await openWorld();
  const seeded = await w.seedDueRequests({ count: 1200 });
  const tail = at(seeded.requestIds, 1199);
  let turns = 0;
  let incarnation = '';
  let reached = false;
  while (turns < 18) {
    turns += 1;
    await w.turn();
    const snapshot = await w.readState();
    if (turns === 1) incarnation = snapshot.incarnation;
    expect(snapshot.incarnation).toBe(incarnation);
    if (snapshot.retries[tail] !== undefined) {
      reached = true;
      break;
    }
  }
  // الذيل اتوصل في ست عشرة دورة أمامية كاملة، والنسخة ما اتعملتش من جديد.
  // لو الدورات خلصت من غير ما نوصل للذيل، الاختبار يفشل هنا مش بعدين.
  expect(reached).toBe(true);
  expect(turns).toBeLessThanOrEqual(18);
  const retained = await w.readState();
  // الجولة خلصت عند الحد المقطوع، فالحالة رجعت لهدوء.
  expect(retained.phase).toBe('IDLE');
  expect(retained.incarnation).toBe(incarnation);
  expect(retryCount(retained)).toBe(1200);
  expect(retained.retries[tail]).toBeDefined();
  // مفيش ولا طلب اتطالب بيه، والكل لسه مجدول.
  expect(await w.readyRequestIds()).toHaveLength(0);
  expect(new Set((await w.requestStatuses()).values())).toEqual(new Set(['SCHEDULED']));
  // البصمة بترجع، فكل طلب مستحق يطلع له حدث جاهزية واحد بس.
  w.tokens.allow = () => true;
  let restoreTurns = 0;
  while (restoreTurns < 60 && retryCount(await w.readState()) > 0) {
    restoreTurns += 1;
    await w.turn();
  }
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(1200);
  expect(new Set(ready).size).toBe(1200);
}, 900_000);

it('sustained_arrivals_do_not_extend_captured_sweep', async () => {
  // N = 30 طلب مستحق، و5 وصولات: واحدة كل دور من الدور التاني لحد السادس، بمعرّفات
  // أعلى من H. ميزانية الدور F=5 أمامي وR=2 إعادة، فالجولة الأمامية بتغطي 5 صفوف
  // في الدور: 30 صف = 6 دور لحد الذيل. الوصولات فوق H ما بتدخلش الجولة دي، والجولة
  // الجاية بتقطع حد جديد فيه الوصولات وبتديها حقها في دورها السابع (7 ≤ 12).
  const w = await openWorld({ budget: { forward: 5, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 30 });
  const tail = at(seeded.requestIds, 29);
  const arrivals: string[] = [];
  let upper: string | undefined;
  for (let turn = 1; turn <= 6; turn += 1) {
    // الوصولات بتدخل فوق الحد المقطوع، عشان الجولة اللي شغالة ما تطوّلش.
    if (turn > 1) {
      const arrival = await w.seedDueRequests({ count: 1, first: 100 + turn });
      arrivals.push(...arrival.requestIds);
    }
    const summary = await w.turn();
    expect(summary.forwardVisits).toBeLessThanOrEqual(5);
    expect(summary.retryVisits).toBeLessThanOrEqual(2);
    const snapshot = await w.readState();
    if (upper === undefined) upper = snapshot.upperId;
    if (turn < 6) {
      expect(snapshot.phase).toBe('SWEEP');
      // الحد المقطوع ما بيتزحزحش مهما وصلات جديدة.
      expect(snapshot.upperId).toBe(upper);
    }
  }
  expect(upper).toBe(tail);
  // الذيل وصل، والوصولات اللي فوق الحد ما دخلتش الجولة اللي اتقطعت.
  const captured = await w.readState();
  expect(captured.retries[tail]).toBeDefined();
  for (const arrival of arrivals) expect(captured.retries[arrival]).toBeUndefined();
  expect(await w.readyRequestIds()).toHaveLength(0);
  // الجولة الجاية بتقطع حد جديد فيه الوصولات وبتديها حقها.
  w.tokens.allow = (requestId) => arrivals.includes(requestId);
  let admitted = 0;
  for (let turn = 1; turn <= 12 && admitted < arrivals.length; turn += 1) {
    await w.turn();
    admitted = (await w.readyRequestIds()).length;
  }
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(arrivals.length);
  for (const arrival of arrivals) expect(ready).toContain(arrival);
}, 120_000);

it('late_commit_and_insert_behind_cursor_join_next_sweep', async () => {
  const w = await openWorld({ budget: { forward: 3, retry: 1 } });
  const seeded = await w.seedDueRequests({ count: 9, first: 10, stride: 10 });
  // صف بين الصف التاني والتالت: معرّفه عدّى عليه المؤشر قبل ما يتعمّم.
  const behind = await w.holdDueRequest({ count: 1, first: 25, stride: 10 });
  // صف أصغر من كل اللي فات: اتلحق بعد ما الجولة قطعت.
  const smaller = await w.holdDueRequest({ count: 1, first: 5, stride: 10 });
  await w.turn();
  const cursor = await w.readState();
  expect(cursor.phase).toBe('SWEEP');
  expect(cursor.cursorId).toBe(at(seeded.requestIds, 2));
  for (let turn = 2; turn <= 3; turn += 1) await w.turn();
  expect((await w.readState()).phase).toBe('IDLE');
  // الصفوف اللي اتسجلت بعد ما عدّى المؤشر ما دخلتش صفحة الجولة اللي اتقطعت.
  const enrolled = w.state.trace.pages.flatMap((page) => page.requestIds);
  expect(enrolled).not.toContain(behind.requestId);
  expect(enrolled).not.toContain(smaller.requestId);
  // دلوقتي يتعمّموا، ويفضلوا بره الجولة دي.
  behind.release();
  smaller.release();
  await behind.done;
  await smaller.done;
  const committed = await w.readState();
  expect(committed.retries[behind.requestId]).toBeUndefined();
  expect(committed.retries[smaller.requestId]).toBeUndefined();
  expect(await w.readyRequestIds()).toHaveLength(0);
  // الجولة الجاية بتاخدهم، ودورين بالكتير كفاية.
  let revisited = 0;
  for (let turn = 1; turn <= 8; turn += 1) {
    await w.turn();
    const snapshot = await w.readState();
    if (
      snapshot.retries[behind.requestId] !== undefined &&
      snapshot.retries[smaller.requestId] !== undefined
    ) {
      revisited = turn;
      break;
    }
  }
  expect(revisited).toBeGreaterThan(0);
}, 120_000);

it('moved_earlier_and_future_due_are_reconsidered', async () => {
  const w = await openWorld({ budget: { forward: 3, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 6 });
  const moved = at(seeded.requestIds, 1);
  const later = at(seeded.requestIds, 3);
  const kept = at(seeded.requestIds, 0);
  const owner = w.base.owner;
  // صف مستقبلي، وصف تاني مستقبلي بس بيستحق قريب.
  await owner`UPDATE rating_requests SET due_at = ${'2026-06-01T16:00:00.000Z'}::timestamptz
    WHERE company_id = ${w.company} AND id = ${moved}`;
  await owner`UPDATE rating_requests SET due_at = ${'2026-06-01T14:30:00.000Z'}::timestamptz
    WHERE company_id = ${w.company} AND id = ${later}`;
  const first = await w.turn();
  expect(first.forwardVisits).toBe(3);
  // المستقبلي ما اتخزنش في خريطة الإعادة، واللي اتخزن لسه فيها.
  const visited = await w.readState();
  expect(visited.retries[moved]).toBeUndefined();
  expect(visited.retries[later]).toBeUndefined();
  expect(visited.retries[kept]).toBeDefined();
  expect(await w.readyRequestIds()).toHaveLength(0);
  // 59-1 بيقدّم موعد الصف، والساعة بتتقدم فصف تاني بيستحق.
  await owner`UPDATE rating_requests SET due_at = ${'2026-06-01T13:00:00.000Z'}::timestamptz
    WHERE company_id = ${w.company} AND id = ${moved}`;
  w.base.clock.at = new Date('2026-06-01T15:00:00.000Z');
  w.tokens.allow = (requestId) => requestId === moved || requestId === later;
  let reconsidered = 0;
  for (let turn = 1; turn <= 8; turn += 1) {
    const summary = await w.turn();
    expect(summary.retryVisits).toBeLessThanOrEqual(2);
    const ready = await w.readyRequestIds();
    if (ready.includes(moved) && ready.includes(later)) {
      reconsidered = turn;
      break;
    }
  }
  expect(reconsidered).toBeGreaterThan(0);
  // الصف اللي اتقدّم اتزار في ترتيب معرّفاته، فالتقدّم ماغيّرش شغل الجولة.
  const page = w.state.trace.pages.find((entry) => entry.requestIds.includes(moved));
  expect(page).toBeDefined();
  expect([...(page?.requestIds ?? [])].sort()).toEqual(page?.requestIds);
}, 120_000);

it('retry_failures_rotate_and_preserve_forward_budget', async () => {
  // N = 8 طلبات مستحقة، وميزانية الدور F=4 أمامي وR=2 إعادة.
  // Q (خريطة الإعادة) = 8 بعد دورين: صفحتان × F=4. أقدم تذكرة (الصف اللي بيفشل دائماً)
  // بتتعاود كل دور لأن ميزانية R بتخد oldest الأول، فحدّ Q هنا دور واحد؛
  // والمسار الأمامي بيفضل 4 زيارات في كل دور على أي حال.
  const w = await openWorld({ budget: { forward: 4, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 8 });
  const oldest = at(seeded.requestIds, 0);
  const blocked = at(seeded.requestIds, 1);
  const survivor = at(seeded.requestIds, 2);
  // فشل دائم في أقدم طلب: لازم يلفّ على الذيل ولا يسدّ رأس المسار.
  w.claimTrap.failBefore.add(oldest);
  // وصف تاني مقفل في معاملة تانية، فالمطالبة بتتخطاه بدل ما تستنى.
  const lock = await w.holdRequestLock(blocked);
  const first = await w.turn();
  lock.release();
  await lock.done;
  expect(first.settlements['RETRY']).toBe(4);
  expect(first.forwardVisits).toBe(4);
  const afterFirst = await w.readState();
  expect(retryCount(afterFirst)).toBe(4);
  expect(afterFirst.retries[oldest]).toBeDefined();
  expect(afterFirst.retries[blocked]).toBeDefined();
  // الدور التاني: أقدم تذكرتين اتخدموا واتلفوا على الذيل.
  const second = await w.turn();
  expect(second.retryVisits).toBe(2);
  expect(second.forwardVisits).toBe(4);
  const afterSecond = await w.readState();
  expect(retryCount(afterSecond)).toBe(8);
  // الفشل الدائم اتعاود دور واحد بس، والصف لسه محجوز في الخريطة.
  expect(afterSecond.retries[oldest]).toBeDefined();
  const tickets = Object.fromEntries(
    Object.entries(afterSecond.retries).map(([id, entry]) => [id, entry.ticket]),
  );
  expect(tickets[oldest] ?? 0).toBeGreaterThan(tickets[survivor] ?? 0);
  // الحجز المحجوز ما بيتحجزش تاني في نفس الدور.
  const ownerToken = w.base.ids.newId();
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  expect(acquired.code).toBe('OK');
  const fence = fenceOf(acquired, ownerToken);
  const firstReservation = await w.state.port.reserveRetries(fence, 2, [
    w.base.ids.newId(),
    w.base.ids.newId(),
  ]);
  expect(firstReservation.value?.reservations).toHaveLength(2);
  const secondReservation = await w.state.port.reserveRetries(
    { ...fence, expectedVersion: firstReservation.version },
    2,
    [w.base.ids.newId(), w.base.ids.newId()],
  );
  const leased = (firstReservation.value?.reservations ?? []).map((entry) => entry.requestId);
  const fresh = (secondReservation.value?.reservations ?? []).map((entry) => entry.requestId);
  expect(fresh.filter((id) => leased.includes(id))).toHaveLength(0);
}, 120_000);

it('retry_saturation_uses_reported_reconciliation', async () => {
  const w = await openWorld({ budget: { forward: 4, retry: 2 }, state: { capacity: 4 } });
  const seeded = await w.seedDueRequests({ count: 12 });
  const overflowed = seeded.requestIds.slice(4, 8);
  await w.turn();
  expect(retryCount(await w.readState())).toBe(4);
  const second = await w.turn();
  // المسار الأمامي كمّل رغم امتلاء الخريطة.
  expect(second.forwardVisits).toBe(4);
  const saturated = await w.readState();
  expect(saturated.overflowCount).toBe(4);
  expect(saturated.reconcileRequired).toBe(true);
  expect(w.diagnostics.overflows).toHaveLength(4);
  // الفيضان ما طردش حاجة معتمدة، والإعادات اللي دخلت لسه في الخريطة.
  expect(retryCount(saturated)).toBe(4);
  for (const id of seeded.requestIds.slice(0, 4)) {
    expect(saturated.retries[id]).toBeDefined();
  }
  for (const id of overflowed) expect(saturated.retries[id]).toBeUndefined();
  // الصفوف اللي اتفيضت بتترجع في الجولة الجاية.
  w.tokens.allow = (requestId) => overflowed.includes(requestId);
  let revisited = 0;
  for (let turn = 1; turn <= 8; turn += 1) {
    await w.turn();
    if ((await w.readyRequestIds()).length >= overflowed.length) {
      revisited = turn;
      break;
    }
  }
  expect(revisited).toBeGreaterThan(0);
  const ready = await w.readyRequestIds();
  for (const id of overflowed) expect(ready).toContain(id);
}, 120_000);
