import { afterEach, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
  RatingClaimState,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import { startBullRunner, type BullRunner } from './rating-claims-bull.fixture.ts';
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

/** بيفتح عالم قبول جديد ويحطه في خانة التنضيف. */
async function openWorld(options?: RatingClaimsWorldOptions): Promise<RatingClaimsWorld> {
  world = await ratingClaimsWorld(options);
  return world;
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

/** مفتاح حالة شركة في Redis. */
function stateKey(prefix: string, companyId: string): string {
  return `${prefix}:rating-claims:v1:{${companyId}}:state`;
}

/**
 * عاملان BullMQ حقيقيان على طابور واحد، بيتنافسوا على نفس الدور.
 *
 * العامل A بياخد المهمة الأولى وبيتوقف في تسجيل الصفحة، فبيضل ماسك للحالة؛ وبعد ما
 * الحجز ينتهي العامل B بياخد المهمة التانية ويمشي قدام. العامل A بيرجع بعدين بسور قديم.
 */
async function runTwoBullWorkers(w: RatingClaimsWorld): Promise<{
  readonly runnerA: BullRunner;
  readonly runnerB: BullRunner;
  readonly aState: TracedState;
}> {
  const aState = tracedState(w.rawState);
  const gate = aState.hold('enrollPage');
  const workerA = w.worker({ state: aState.port });
  const workerB = w.worker();
  const prefix = `${w.prefix}:bull`;
  const runnerA = await startBullRunner({
    redisUrl,
    prefix,
    turn: { execute: (companyId) => workerA.execute(companyId) },
  });
  runners.push(runnerA);
  const held = runnerA.enqueue(w.company);
  await gate.acquired;
  await waitForLeaseExpiry(w);
  const runnerB = await startBullRunner({
    redisUrl,
    prefix,
    turn: { execute: (companyId) => workerB.execute(companyId) },
  });
  runners.push(runnerB);
  await runnerB.enqueue(w.company);
  gate.release();
  await held;
  return { runnerA, runnerB, aState };
}

/** صفوف الشركة التانية: نفس معرّف الطلب في الشركة الأولى، ومعاهم طلب تاني بره الأول. */
async function seedCompanyBRows(w: RatingClaimsWorld, shared: string): Promise<string> {
  const owner = w.base.owner;
  const bCustomer = w.base.ids.newId();
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${w.otherCompany}, ${bCustomer}, 'Company B customer', '+999999899999', 'en', now(), now())`;
  // عميل تاني للشركة التانية، لأن يوم الطلب مفروض يبقى فريد مع العميل.
  const bSecondCustomer = w.base.ids.newId();
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${w.otherCompany}, ${bSecondCustomer}, 'Company B second customer', '+999999899998', 'en', now(), now())`;
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${shared}, ${w.otherBusiness}, ${bCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  const bOnly = w.base.ids.newId();
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${bOnly}, ${w.otherBusiness}, ${bSecondCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  return bOnly;
}

/** عزل المستأجر: دور الشركة الأولى ما بيقرش ولا بيكتبش صف الشركة التانية. */
async function expectTenantIsolation(w: RatingClaimsWorld, bOnly: string): Promise<void> {
  const seenByA = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`SELECT id FROM rating_requests
      WHERE company_id = ${w.otherCompany}`);
    return rows.length;
  });
  expect(seenByA).toBe(0);
  // دور صاحب القاعدة بيشوف صف الشركة التانية، فالعزل من الـ RLS مش من الاستعلام.
  const ownerSeen = await w.base.owner`SELECT id FROM rating_requests
    WHERE company_id = ${w.otherCompany}`;
  expect(ownerSeen).toHaveLength(2);
  const writtenByA = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`UPDATE rating_requests SET status = 'CANCELLED'
      WHERE company_id = ${w.otherCompany} AND id = ${bOnly} RETURNING id`);
    return rows.length;
  });
  expect(writtenByA).toBe(0);
}

it('two_workers_expired_owner_cannot_regress_state', async () => {
  const w = await openWorld({ state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 3 });
  w.tokens.allow = () => true;
  // العامل A بيتوقف في تسجيل الصفحة، فبيضل ماسك للحالة؛ وB يكمّل بعد انتهاء الحجز.
  const { runnerA, runnerB, aState } = await runTwoBullWorkers(w);
  expect(runnerB.summaries[0]?.end).toBe('COMPLETED');
  const readyAfterB = await w.readyRequestIds();
  expect(readyAfterB).toHaveLength(3);
  // A بيرجع، فأي كتابة ليه مرفوضة بسور قديم.
  expect(runnerA.summaries[0]?.end).toBe('FENCE_LOST');
  expect(w.diagnostics.fenceLosses).toContain('STALE');
  const enrollCall = at(
    aState.trace.calls.filter((call) => call.method === 'enrollPage'),
    0,
  );
  const staleFence = enrollCall.fence;
  const staleSettlement = await w.state.port.settlePage(
    staleFence,
    'page-that-is-not-there',
    'work-token',
    'RETRY',
  );
  expect(staleSettlement.code).toBe('STALE');
  const staleRenew = await w.state.port.renew(staleFence);
  expect(staleRenew.code).toBe('STALE');
  const staleRelease = await w.state.port.release(staleFence);
  expect(staleRelease.code).toBe('STALE');
  // كل طلب ناجح له حدث واحد بس، ومفيش تكرار من دور A.
  const ready = await w.readyRequestIds();
  expect(ready).toHaveLength(3);
  expect(new Set(ready).size).toBe(3);
  for (const requestId of seeded.requestIds) expect(ready).toContain(requestId);
}, 120_000);

/**
 * العامل القديم ياخد الحالة ويسجل صفحة فيها شغل، وبيرجع سور قديم.
 *
 * @param w عالم القبول
 * @param requestIds طلبات الدفعة، وآخرها هو الحد المقطوع
 * @returns السور القديم ومعرّف الصفحة ورمز شغل بندها
 */
async function enrollOldWorker(
  w: RatingClaimsWorld,
  requestIds: readonly string[],
): Promise<{
  readonly fence: ClaimStateFence;
  readonly pageId: string;
  readonly workToken: string;
}> {
  const ownerA = w.base.ids.newId();
  const acquiredA = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerA);
  const fenceA = fenceOf(acquiredA, ownerA);
  const sweepId = w.base.ids.newId();
  const begun = await w.state.port.begin(fenceA, sweepId, at(requestIds, 2));
  const fenceA2 = { ...fenceA, expectedVersion: begun.version };
  const pageId = w.base.ids.newId();
  const entries = requestIds.map((requestId) => ({
    requestId,
    workToken: w.base.ids.newId(),
  }));
  const enrolled = await w.state.port.enrollPage(fenceA2, sweepId, null, pageId, entries, true);
  return {
    fence: { ...fenceA2, expectedVersion: enrolled.version },
    pageId,
    workToken: at(entries, 0).workToken,
  };
}

/** كل أمر بالسور القديم لازم يترفض، حتى لو رقم النسخة هو رقم الحالة الحالية. */
async function expectEveryCommandStale(
  state: RatingClaimState,
  fence: ClaimStateFence,
  pageId: string,
  workToken: string,
  requestId: string,
): Promise<void> {
  expect((await state.settlePage(fence, pageId, workToken, 'RETRY')).code).toBe('STALE');
  expect((await state.settleRetry(fence, requestId, workToken, 'RETRY')).code).toBe('STALE');
  expect((await state.renew(fence)).code).toBe('STALE');
  expect((await state.release(fence)).code).toBe('STALE');
}

it('recreated_state_rejects_all_old_fences', async () => {
  const w = await openWorld();
  const seeded = await w.seedDueRequests({ count: 3 });
  // حالة الشركة التانية موجودة، والحذف لازم ما يمسّهاش.
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(w.otherCompany, w.base.ids.newId(), otherOwner);
  expect(otherAcquired.code).toBe('OK');
  const otherFence = fenceOf(otherAcquired, otherOwner);
  // العامل A ياخد الحالة ويسجل صفحة فيها شغل.
  const old = await enrollOldWorker(w, seeded.requestIds);
  // حذف حالة الشركة المختبرة بس.
  await w.redis.del(stateKey(w.prefix, w.company));
  // العامل B يعمل الحالة من جديد: نسخة جديدة بنفس الرقم.
  const ownerB = w.base.ids.newId();
  const acquiredB = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerB);
  expect(acquiredB.code).toBe('OK');
  expect(acquiredB.version).toBe(1);
  expect(acquiredB.value?.incarnation).not.toBe(old.fence.incarnation);
  // سور A مرفوض على كل حاجة، حتى إقرار الإعادة.
  await expectEveryCommandStale(
    w.state.port,
    old.fence,
    old.pageId,
    old.workToken,
    at(seeded.requestIds, 0),
  );
  // الدليل على النسخة مش على الرقم: نفس رقم النسخة بتاع B، بس نسخة A القديمة.
  const sameVersionOldIncarnation = { ...old.fence, expectedVersion: acquiredB.version };
  expect(sameVersionOldIncarnation.expectedVersion).toBe(acquiredB.version);
  await expectEveryCommandStale(
    w.state.port,
    sameVersionOldIncarnation,
    old.pageId,
    old.workToken,
    at(seeded.requestIds, 0),
  );
  // حالة B ما اتغيرتش، وحالة الشركة التانية ما اتمسحتش.
  const afterB = await w.state.port.read(w.company);
  expect(afterB.value?.incarnation).toBe(acquiredB.value?.incarnation);
  expect(afterB.version).toBe(acquiredB.version);
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

it('tenant_isolation_covers_state_and_claims', async () => {
  const w = await openWorld({ budget: { forward: 3, retry: 2 } });
  const seeded = await w.seedDueRequests({ count: 2 });
  const shared = at(seeded.requestIds, 0);
  const bOnly = await seedCompanyBRows(w, shared);
  // مفاتيح الحالة مختلفة، لأن المفتاح فيه الشركة.
  expect(stateKey(w.prefix, w.company)).not.toBe(stateKey(w.prefix, w.otherCompany));
  const ownerToken = w.base.ids.newId();
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  const fence = fenceOf(acquired, ownerToken);
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(w.otherCompany, w.base.ids.newId(), otherOwner);
  expect(otherAcquired.code).toBe('OK');
  // سور الشركة الأولى مرفوض على حالة الشركة التانية.
  const crossed = await w.state.port.settlePage(
    { ...fence, companyId: w.otherCompany },
    'page',
    'work',
    'RETRY',
  );
  expect(crossed.code).toBe('STALE');
  // سور الشركة الأولى اتسلّم، عشان الدور ياخد ملكية الحالة: من غير كده الجولة بترجع
  // تاني من غير ما تاخد الحالة، فما بتطلعش أي مطالبة.
  const releasedA = await w.state.port.release(fence);
  expect(releasedA.code).toBe('OK');
  // سور الشركة التانية اتسلّم كمان، عشان التنظيف يبقى واضح: الدور بيلمس الشركة الأولى بس.
  const releasedB = await w.state.port.release(fenceOf(otherAcquired, otherOwner));
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
  const bRow = await w.base.db.withTenant(w.company, async (tx) =>
    ratingClaimRepository.findRequest(tx, w.company, bOnly),
  );
  expect(bRow).toBeNull();
  const aRow = await w.base.db.withTenant(w.company, async (tx) =>
    ratingClaimRepository.findRequest(tx, w.company, shared),
  );
  expect(aRow?.customerId).toBe(at(seeded.customerIds, 0));
  const bEvents = await w.base.owner`SELECT count(*)::int AS total FROM outbox
    WHERE company_id = ${w.otherCompany} AND event_type = 'RatingRequestReady'`;
  expect(Number(bEvents[0]?.['total'])).toBe(0);
}, 120_000);
