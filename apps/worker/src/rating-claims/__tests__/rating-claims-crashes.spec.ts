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

const opened: RatingClaimsWorld[] = [];

afterEach(async () => {
  while (opened.length > 0) {
    const world = opened.pop();
    await world?.close();
  }
});

/** بيفتح عالم قبول جديد ويحطه في خانة التنضيف. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  const world = await ratingClaimsWorld(options);
  opened.push(world);
  return world;
}

/** يقفل عالم قبول ويشيله من خانة التنضيف. */
async function closeWorld(world: RatingClaimsWorld): Promise<void> {
  await world.close();
  const index = opened.indexOf(world);
  if (index >= 0) opened.splice(index, 1);
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

/** انتظار قصير، مستخدم في انتهاء الحجز بس. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** انهيار بعد قراءة الصفحة وقبل تسجيلها: المؤشر ما اتغيّرش ومفيش يوملة. */
async function crashBeforeEnrollment(): Promise<void> {
  const world = await openWorld({ budget: { forward: 3, retry: 1 } });
  const seeded = await world.seedDueRequests({ count: 3 });
  world.tokens.allow = () => true;
  world.state.crashBefore('enrollPage');
  await expect(world.turn()).rejects.toThrow(/CRASH/);
  const crashed = await world.readState();
  expect(crashed.cursorId).toBeUndefined();
  expect(crashed.page).toBeUndefined();
  expect(crashed.phase).toBe('SWEEP');
  // الدور الجاي بيقرأ نفس الصفحة وبيطالب بيها، فمفيش طلب ضايع.
  await world.turn();
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
    false,
  );
  expect(enrolled.code).toBe('OK');
  expect((await world.readState()).page?.entries).toHaveLength(3);
  // العامل مات، فالحجز خلص والدور الجاي بياخد اليومية ويكمّلها.
  await delay(1300);
  const summary = await world.turn();
  expect(summary.settlements['TERMINAL']).toBe(3);
  const claimed = await world.readyRequestIds();
  expect(claimed).toHaveLength(3);
  for (const requestId of rows.requestIds) expect(claimed).toContain(requestId);
  await closeWorld(world);
}

/** ضياع رد التسجيل: التنفيذ حصل والعميل ما عرفش، فالمطابقة بصفحة الجولة بتلحق. */
async function loseEnrollmentReply(): Promise<void> {
  const world = await openWorld({ budget: { forward: 3, retry: 1 } });
  const rows = await world.seedDueRequests({ count: 3 });
  world.tokens.allow = () => true;
  world.state.loseReply('enrollPage');
  await expect(world.turn()).rejects.toThrow(/REPLY_LOST/);
  const enrolled = await world.readState();
  expect(enrolled.page?.entries).toHaveLength(3);
  expect(await world.readyRequestIds()).toHaveLength(0);
  // الدور الجاي بيرجّع اليومية المسجّلة، فكل طلب يطلع له event واحد بس.
  await world.turn();
  const ready = await world.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  for (const requestId of rows.requestIds) expect(ready).toContain(requestId);
  await closeWorld(world);
}

it('crash_before_and_after_page_enrollment', async () => {
  await crashBeforeEnrollment();
  await crashAfterEnrollment();
  await loseEnrollmentReply();
}, 300_000);

it('crash_at_db_commit_and_settlement', async () => {
  const w = await openWorld({ budget: { forward: 4, retry: 1 } });
  const seeded = await w.seedDueRequests({ count: 4 });
  const rolledBack = at(seeded.requestIds, 0);
  const uncertain = at(seeded.requestIds, 1);
  w.tokens.allow = () => true;
  // الصف الأول بيرجع من المعاملة، والتاني الـ commit بتاعه بيتم بس الرد بيضيع.
  w.claimTrap.failBefore.add(rolledBack);
  w.txTrap.lostReplies.add(uncertain);
  await w.turn();
  const afterFirst = await w.readState();
  expect(afterFirst.retries[rolledBack]).toBeDefined();
  expect(afterFirst.retries[uncertain]).toBeDefined();
  const statuses = await w.requestStatuses();
  expect(statuses.get(rolledBack)).toBe('SCHEDULED');
  expect(statuses.get(uncertain)).toBe('SENDING');
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(ready).not.toContain(rolledBack);
  expect(ready.filter((id) => id === uncertain)).toHaveLength(1);
  // عدم اليقين مرة واحدة بس: الدور الجاي يشوف السطر نفسه وما يحصلوش تاني.
  w.txTrap.lostReplies.delete(uncertain);
  // ضياع رد الإقرار: التسوية اتنفّذت والعميل ما عرفش، فالطلب ما يتشالش.
  w.state.loseReply('settleRetry');
  await expect(w.turn()).rejects.toThrow(/REPLY_LOST/);
  const afterLost = await w.readState();
  expect(afterLost.retries[rolledBack]).toBeDefined();
  expect(await w.readyRequestIds()).toHaveLength(3);
  // الدور اللي بعده بياخد الشغل المعلّق ويكمّله: الصف المؤكد بيتشال، والحدث ما يتضاعفش.
  await w.turn();
  const finished = await w.readState();
  expect(finished.retries[uncertain]).toBeUndefined();
  expect(finished.retries[rolledBack]).toBeDefined();
  const finalReady = await w.readyRequestIds();
  expect(finalReady).toHaveLength(3);
  expect(finalReady.filter((id) => id === uncertain)).toHaveLength(1);
  expect((await w.requestStatuses()).get(uncertain)).toBe('SENDING');
}, 300_000);
