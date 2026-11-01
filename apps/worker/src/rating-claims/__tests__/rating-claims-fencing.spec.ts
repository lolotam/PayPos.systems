import { afterEach, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

import type {
  ClaimStateFence,
  ClaimStateResult,
  ClaimStateSnapshot,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import {
  at,
  ratingClaimsWorld,
  type RatingClaimsWorld,
  type RatingClaimsWorldOptions,
} from './rating-claims-world.fixture.ts';
import { tracedState } from './rating-claims-trace.fixture.ts';

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

/** انتظار قصير، مستخدم في انتهاء الحجز بس. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

it('two_workers_expired_owner_cannot_regress_state', async () => {
  const w = await openWorld({ state: { leaseMs: 1000 } });
  const seeded = await w.seedDueRequests({ count: 3 });
  w.tokens.allow = () => true;
  // العامل A بيتوقف في تسجيل الصفحة، فبيضل ماسك للحالة.
  const aState = tracedState(w.rawState);
  const gate = aState.hold('enrollPage');
  const workerA = w.worker({ state: aState.port });
  const held = workerA.execute(w.company);
  await gate.acquired;
  // الحجز بتاع A خلص، فالعامل B يقدر ياخد الحالة ويكمّل.
  await delay(1300);
  const summaryB = await w.turn();
  expect(summaryB.end).toBe('COMPLETED');
  const readyAfterB = await w.readyRequestIds();
  expect(readyAfterB).toHaveLength(3);
  // A بيرجع، فأي كتابة ليه مرفوضة بسور قديم.
  gate.release();
  const summaryA = await held;
  expect(summaryA.end).toBe('FENCE_LOST');
  expect(w.diagnostics.fenceLosses).toContain('STALE');
  const enrollCall = at(aState.trace.calls.filter((call) => call.method === 'enrollPage'), 0);
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

it('recreated_state_rejects_all_old_fences', async () => {
  const w = await openWorld();
  const seeded = await w.seedDueRequests({ count: 3 });
  // حالة الشركة التانية موجودة، والحذف لازم ما يمسّهاش.
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(
    w.otherCompany,
    w.base.ids.newId(),
    otherOwner,
  );
  expect(otherAcquired.code).toBe('OK');
  const otherFence = fenceOf(otherAcquired, otherOwner);
  // العامل A ياخد الحالة ويسجل صفحة فيها شغل.
  const ownerA = w.base.ids.newId();
  const acquiredA = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerA);
  const fenceA = fenceOf(acquiredA, ownerA);
  const sweepId = w.base.ids.newId();
  const begun = await w.state.port.begin(fenceA, sweepId, at(seeded.requestIds, 2));
  const fenceA2 = { ...fenceA, expectedVersion: begun.version };
  const pageId = w.base.ids.newId();
  const entries = seeded.requestIds.map((requestId) => ({
    requestId,
    workToken: w.base.ids.newId(),
  }));
  const enrolled = await w.state.port.enrollPage(
    fenceA2,
    sweepId,
    null,
    pageId,
    entries,
    true,
  );
  const fenceA3 = { ...fenceA2, expectedVersion: enrolled.version };
  // حذف حالة الشركة المختبرة بس.
  await w.redis.del(stateKey(w.prefix, w.company));
  // العامل B يعمل الحالة من جديد: نسخة جديدة بنفس الرقم.
  const ownerB = w.base.ids.newId();
  const acquiredB = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerB);
  expect(acquiredB.code).toBe('OK');
  expect(acquiredB.version).toBe(1);
  expect(acquiredB.value?.incarnation).not.toBe(fenceA.incarnation);
  // سور A مرفوض على كل حاجة، حتى إقرار الإعادة.
  const stalePage = await w.state.port.settlePage(
    fenceA3,
    pageId,
    at(entries, 0).workToken,
    'RETRY',
  );
  expect(stalePage.code).toBe('STALE');
  const staleAck = await w.state.port.settleRetry(
    fenceA3,
    at(seeded.requestIds, 0),
    at(entries, 0).workToken,
    'RETRY',
  );
  expect(staleAck.code).toBe('STALE');
  const staleRenew = await w.state.port.renew(fenceA3);
  expect(staleRenew.code).toBe('STALE');
  const staleRelease = await w.state.port.release(fenceA3);
  expect(staleRelease.code).toBe('STALE');
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
  const owner = w.base.owner;
  const bCustomer = w.base.ids.newId();
  await owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${w.otherCompany}, ${bCustomer}, 'Company B customer', '+999999899999', 'en', now(), now())`;
  // نفس معرّف الطلب في الشركة التانية، ومعاهم طلب تاني بره الأول.
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${shared}, ${w.otherBusiness}, ${bCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  const bOnly = w.base.ids.newId();
  await owner`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
    VALUES (${w.otherCompany}, ${bOnly}, ${w.otherBusiness}, ${bCustomer}, '2026-06-01',
      ${'01920000-0000-7000-8000-0000000000b2'}, '2026-06-01T13:10:00.000Z', '2026-06-01T19:30:00.000Z', 'SCHEDULED')`;
  // مفاتيح الحالة مختلفة، لأن المفتاح فيه الشركة.
  expect(stateKey(w.prefix, w.company)).not.toBe(stateKey(w.prefix, w.otherCompany));
  const ownerToken = w.base.ids.newId();
  const acquired = await w.state.port.acquire(w.company, w.base.ids.newId(), ownerToken);
  const fence = fenceOf(acquired, ownerToken);
  const otherOwner = w.base.ids.newId();
  const otherAcquired = await w.state.port.acquire(
    w.otherCompany,
    w.base.ids.newId(),
    otherOwner,
  );
  expect(otherAcquired.code).toBe('OK');
  // سور الشركة الأولى مرفوض على حالة الشركة التانية.
  const crossed = await w.state.port.settlePage(
    { ...fence, companyId: w.otherCompany },
    'page',
    'work',
    'RETRY',
  );
  expect(crossed.code).toBe('STALE');
  // دور الشركة الأولى ما بيقراش ولا بيكتبش ولا يطلعش أحداث للشركة التانية.
  await w.turn();
  const seenByA = await w.base.db.withTenant(w.company, async (tx) => {
    const rows = await tx.execute(sql`SELECT id FROM rating_requests
      WHERE company_id = ${w.otherCompany}`);
    return rows.length;
  });
  expect(seenByA).toBe(0);
  const bRow = await w.base.db.withTenant(w.company, async (tx) =>
    ratingClaimRepository.findRequest(tx, w.company, bOnly),
  );
  expect(bRow).toBeNull();
  const aRow = await w.base.db.withTenant(w.company, async (tx) =>
    ratingClaimRepository.findRequest(tx, w.company, shared),
  );
  expect(aRow?.customerId).toBe(at(seeded.customerIds, 0));
  const bEvents = await owner`SELECT count(*)::int AS total FROM outbox
    WHERE company_id = ${w.otherCompany} AND event_type = 'RatingRequestReady'`;
  expect(Number(bEvents[0]?.['total'])).toBe(0);
}, 120_000);
