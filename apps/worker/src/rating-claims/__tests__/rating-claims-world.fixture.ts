// مُنشئ عالم القبول: القاعدة الحقيقية، وRedis الحقيقية، ومهايات المطالبة الحقيقية.
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';

import type { Tx } from '@pospay/db';
import { TENANT, USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { performerLabelFormatter } from '../../modules/customers/index.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import { branchScheduleHoursAdapter } from '../../modules/customers/persistence/branch-schedule-hours.adapter.ts';
import { businessNames } from '../../modules/customers/persistence/business-names.adapter.ts';
import { performerNameAdapter } from '../../modules/customers/persistence/performer-name.adapter.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from '../../modules/customers/persistence/rating-claim.transactions.ts';
import { ratingOutbox } from '../../modules/customers/persistence/rating-outbox.adapter.ts';
import { ratingRequestsSwitch } from '../../modules/customers/persistence/rating-requests-switch.adapter.ts';
import { redisRatingClaimState } from '../../modules/customers/persistence/redis-rating-claim-state.ts';
import {
  LEASE_MS,
  MAX_TURN_MS,
  PAGE_RESERVE_BYTES,
  RETRY_CAPACITY,
  STATE_MAX_BYTES,
  type VisitBudget,
} from '../../modules/customers/domain/rating-claim-scheduling.ts';
import type { RatingClaimDiagnostics } from '../../modules/customers/ports/rating-claim-diagnostics.port.ts';
import type { RatingClaimTransactions } from '../../modules/customers/ports/rating-claim-transactions.port.ts';
import type {
  ClaimStateSnapshot,
  RatingClaimState,
} from '../../modules/customers/ports/rating-claim-state.port.ts';
import type { RatingTokenPort } from '../../modules/customers/ports/rating-token.port.ts';
import { ClaimRatingRequest } from '../../modules/customers/use-cases/claim-rating-request/claim-rating-request.ts';
import {
  ClaimRatingRequests,
  type RatingClaimsClaim,
} from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import {
  everyDay,
  ratingClaimsFixture,
  testTokenHash,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';
import {
  seedDueRows,
  seedPlan,
  seedRequestRows,
  seedVisitRows,
  type SeededRows,
  type SeedOptions,
  type SeedTarget,
} from './rating-claims-rows.fixture.ts';
import {
  createGate,
  recordingDiagnostics,
  tracedState,
  type RecordingDiagnostics,
  type TracedState,
} from './rating-claims-trace.fixture.ts';
import type {
  ClaimTrap,
  HeldLock,
  HeldSeed,
  RatingClaimsWorld,
  RatingClaimsWorldOptions,
  RatingClaimStateLimits,
  TransactionTrap,
  WorkerOptions,
} from './rating-claims-world.types.ts';

export { BUSINESS_DATE, DUE_AT, SEND_DEADLINE, VISIT_AT } from './rating-claims-rows.fixture.ts';
export type { SeededRows, SeedOptions };
export type { RecordingDiagnostics };
export type {
  ClaimTrap,
  HeldLock,
  HeldSeed,
  RatingClaimsWorld,
  RatingClaimsWorldOptions,
  RatingClaimStateLimits,
  TransactionTrap,
  WorkerOptions,
} from './rating-claims-world.types.ts';

export const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

/** مواعيد الفرع في الاختبار: كل يوم من العاشرة إلى العاشرة مساءً. */
const KUWAIT = 'Asia/Kuwait';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);

/** ساعة الاختبار: بعد الاستحقاق وقبل الموعد النهائي. */
export const CLOCK_AT = new Date('2026-06-01T14:00:00.000Z');

/** حدود الحالة بالافتراضات بتاعت الإنتاج، مع تظليل اللي الاختبار غيّره. */
function limitsOf(overrides?: Partial<RatingClaimStateLimits>): RatingClaimStateLimits {
  return {
    capacity: overrides?.capacity ?? RETRY_CAPACITY,
    leaseMs: overrides?.leaseMs ?? LEASE_MS,
    maxTurnMs: overrides?.maxTurnMs ?? MAX_TURN_MS,
    // الباك رجوع فوري في الاختبار، عشان نعدّ الدورات من غير انتظار الوقت الحقيقي.
    backoffMs: overrides?.backoffMs ?? 0,
    maxBytes: overrides?.maxBytes ?? STATE_MAX_BYTES,
    reserveBytes: overrides?.reserveBytes ?? PAGE_RESERVE_BYTES,
  };
}

/** عنصر من قائمة، وبيطلع لو مش موجود. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error('RATING_CLAIM_FIXTURE_INDEX_OUT_OF_RANGE');
  return item;
}

/** أجزاء العالم اللي بتتبني مع بعض قبل ما تتجمع في كائن واحد. */
interface WorldParts {
  readonly base: RatingClaimsFixture;
  readonly company: string;
  readonly otherCompany: string;
  readonly otherBusiness: string;
  readonly branchId: string;
  readonly redis: Redis;
  readonly prefix: string;
  readonly rawState: RatingClaimState;
  readonly state: TracedState;
  readonly transactions: RatingClaimTransactions<Tx>;
  readonly diagnostics: RecordingDiagnostics;
  readonly tokens: { allow(requestId: string): boolean };
  readonly claimTrap: ClaimTrap;
  readonly txTrap: TransactionTrap;
  readonly budget: VisitBudget;
}

/** بيشيل مفاتيح البادئة اللي للمختبر بس، من غير لمس أي مفتاح تاني في Redis. */
async function cleanPrefix(redis: Redis, prefix: string): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
}

/** هدف الزرع: الشركة والنشاط والفرع اللي بتتباع الزيارات. */
function seedTarget(parts: WorldParts): SeedTarget {
  return {
    company: parts.company,
    businessId: TENANT.A.business,
    branchId: parts.branchId,
  };
}

/**
 * مزدوج البصمة: يطلع null لما البصمة مش متاحة، زي ما القدرة الحقيقية بتتأخر.
 *
 * البصمة null جزء من عقد القدرة نفسها (RatingTokenPort)، فمفيش أي تمثيل كاذب هنا.
 */
function tokenPort(tokens: { allow(requestId: string): boolean }): RatingTokenPort {
  return {
    claim: (identity) =>
      tokens.allow(identity.ratingRequestId)
        ? { tokenHash: testTokenHash(identity.ratingRequestId), keyVersion: 1 }
        : null,
  };
}

/**
 * مطالبة الطلب الواحد بنفس منافذ الإنتاج، مع مزدوج البصمة بدل كود الاشتقاق.
 *
 * المصنع في جذر الموديل بياخد كود اشتقاق دايماً، والقدرة الحقيقية بترجع null بس لما
 * القدرة كلها مقفولة؛ الاختبار محتاج يعطّل البصمة لطلب واحد ويشبّعها لغيره.
 */
function buildClaim(
  base: RatingClaimsFixture,
  claimTrap: ClaimTrap,
  tokens: { allow(requestId: string): boolean },
): RatingClaimsClaim<Tx> {
  const realClaim = new ClaimRatingRequest<Tx>(
    {
      switch: ratingRequestsSwitch,
      hours: branchScheduleHoursAdapter,
      names: businessNames,
      daySessions: daySessionsReader,
      performers: performerNameAdapter,
      label: performerLabelFormatter,
      claims: ratingClaimRepository,
      token: tokenPort(tokens),
      outbox: ratingOutbox,
    },
    base.ids,
    base.clock,
  );
  return {
    execute: (tx, input) => {
      if (claimTrap.failBefore.has(input.request.id)) {
        return Promise.reject(new Error('RATING_CLAIM_ROLLED_BACK'));
      }
      return realClaim.execute(tx, input);
    },
  };
}

/** معاملات المستأجر مع خطّاف ضياع رد الـ commit بعد ما المعاملة تقفل. */
function buildTransactions(
  raw: RatingClaimTransactions<Tx>,
  txTrap: TransactionTrap,
): RatingClaimTransactions<Tx> {
  return {
    upperId: (companyId) => raw.upperId(companyId),
    pageIds: (companyId, after, through, limit) =>
      raw.pageIds(companyId, after, through, limit),
    withRequest: async (companyId, requestId, work) => {
      const result = await raw.withRequest(companyId, requestId, work);
      if (txTrap.lostReplies.has(requestId)) {
        throw new Error('RATING_CLAIM_COMMIT_REPLY_LOST');
      }
      return result;
    },
  };
}

/** موظف جديد لدور خدمة مستقل برمز مالك خاص بيه. */
function workerFactory(
  base: RatingClaimsFixture,
  state: RatingClaimState,
  claim: RatingClaimsClaim<Tx>,
  transactions: RatingClaimTransactions<Tx>,
  diagnostics: RatingClaimDiagnostics,
  budget: VisitBudget,
): (options?: WorkerOptions) => ClaimRatingRequests<Tx> {
  return (workerOptions = {}) =>
    new ClaimRatingRequests<Tx>(
      {
        state: workerOptions.state ?? state,
        transactions,
        requests: ratingClaimRepository,
        claim,
        diagnostics: workerOptions.diagnostics ?? diagnostics,
      },
      base.ids,
      base.clock,
      workerOptions.budget ?? budget,
    );
}

/** يفتح مفتاح طلبات التقييم للنشاط، وإلا المطالبة بتلغي الطلب بدل ما تطلبه. */
async function openRatingRequests(base: RatingClaimsFixture): Promise<void> {
  await base.owner`INSERT INTO rating_settings
      (company_id, id, business_id, requests_enabled, updated_by, updated_at, revision)
    VALUES (${TENANT.A.company}, ${base.ids.newId()}, ${TENANT.A.business}, true, ${USER}, now(), 1)`;
}

/** يزرع دفعة طلبات مستحقة مع زياراتها، كلها في معاملة واحدة. */
async function seedDueRequestsOf(
  parts: WorldParts,
  options: SeedOptions,
): Promise<SeededRows> {
  const plan = seedPlan(seedTarget(parts), options);
  await seedDueRows(parts.base.owner, plan);
  return { requestIds: plan.requestIds, customerIds: plan.customerIds };
}

/** يزرع صف طلب في معاملة مفتوحة، والـ commit بيتأجل لحد ما الاختبار يفتحه. */
async function holdDueRequestOf(parts: WorldParts, options: SeedOptions): Promise<HeldSeed> {
  const plan = seedPlan(seedTarget(parts), options);
  const gate = createGate();
  const done = parts.base.owner.begin(async (tx) => {
    await seedVisitRows(tx, plan);
    await seedRequestRows(tx, plan);
    gate.markAcquired();
    await gate.wait();
  });
  await gate.acquired;
  return {
    requestId: at(plan.requestIds, 0),
    inserted: gate.acquired,
    release: gate.release,
    done,
  };
}

/** يقفل صف طلب في معاملة مفتوحة، عشان نجرّب طلب مقفل في معاملة تانية. */
async function holdRequestLockOf(parts: WorldParts, requestId: string): Promise<HeldLock> {
  const gate = createGate();
  const done = parts.base.db.withTenant(parts.company, async (tx) => {
    await tx.execute(sql`SELECT id FROM rating_requests
      WHERE company_id = ${parts.company} AND id = ${requestId} FOR UPDATE`);
    gate.markAcquired();
    await gate.wait();
  });
  await gate.acquired;
  return { locked: gate.acquired, release: gate.release, done };
}

/** لقطة الحالة، وبتطلع لو الحالة مش موجودة. */
async function readStateOf(
  state: RatingClaimState,
  companyId: string,
): Promise<ClaimStateSnapshot> {
  const read = await state.read(companyId);
  if (read.code !== 'OK' || read.value === undefined) {
    throw new Error(`RATING_CLAIM_STATE_UNREADABLE:${read.code}`);
  }
  return read.value;
}

/** حالات الطلبات من القاعدة بعد الدور، مقرونة بمعرّف كل طلب. */
async function requestStatusesOf(base: RatingClaimsFixture): Promise<Map<string, string>> {
  const rows = await base.owner`SELECT id, status FROM rating_requests
    WHERE company_id = ${TENANT.A.company}`;
  const statuses = new Map<string, string>();
  for (const row of rows) statuses.set(String(row['id']), String(row['status']));
  return statuses;
}

/** معرّفات الطلبات اللي وصلها حدث جاهزية في نفس المعاملة. */
async function readyRequestIdsOf(base: RatingClaimsFixture): Promise<string[]> {
  const rows = await base.owner`SELECT payload FROM outbox
    WHERE company_id = ${TENANT.A.company} AND event_type = 'RatingRequestReady'`;
  return rows.map((row) => {
    const payload = row['payload'] as { rating_request_id: string };
    return payload.rating_request_id;
  });
}

/** يقفل عميل Redis من غير ما يرمي لو ما اتصلش أصلاً. */
async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
    return;
  }
  if (redis.status === 'end') return;
  redis.disconnect();
}

/** ساعة Redis الحقيقية بالمللي ثانية، عشان نقارن بيها نهاية الحجز. */
async function serverNowMs(redis: Redis): Promise<number> {
  const [seconds, micros] = await redis.time();
  return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
}

/**
 * يستنى انتهاء حجز الحالة بدل نوم ثابت.
 *
 * الحجز بيتحسب بساعة Redis نفسها، فالمقارنة لازم تكون بنفس الساعة؛ والانتظار بيقف
 * بمهلة قصوى عشان الاختبار ما يقعدش معلّق لو الحجز ما انتهاش.
 */
export async function waitForLeaseExpiry(
  world: RatingClaimsWorld,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const read = await world.state.port.read(world.company);
    const leaseUntil = read.value?.leaseUntil;
    if (read.code !== 'OK' || leaseUntil === undefined) return;
    if (leaseUntil <= (await serverNowMs(world.redis))) return;
    if (Date.now() > deadline) throw new Error('RATING_CLAIM_LEASE_NOT_EXPIRED');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** يجمع أجزاء العالم في الكائن اللي بتستخدمه الاختبارات. */
function buildWorld(
  parts: WorldParts,
  worker: (options?: WorkerOptions) => ClaimRatingRequests<Tx>,
): RatingClaimsWorld {
  const { base, state } = parts;
  return {
    ...parts,
    worker,
    turn: async (target) => (target ?? worker()).execute(parts.company),
    readState: async () => readStateOf(state.port, parts.company),
    seedDueRequests: async (options) => seedDueRequestsOf(parts, options),
    holdDueRequest: async (options) => holdDueRequestOf(parts, options),
    holdRequestLock: async (requestId) => holdRequestLockOf(parts, requestId),
    requestStatuses: async () => requestStatusesOf(base),
    readyRequestIds: async () => readyRequestIdsOf(base),
    close: async () => {
      await cleanPrefix(parts.redis, parts.prefix);
      await closeRedis(parts.redis);
      await base.close();
    },
  };
}

/**
 * بيبني عالم القبول: قاعدة مستنسخة ومنفذ حالة حقيقي ودور خدمة على المهايات الحقيقية.
 */
export async function ratingClaimsWorld(
  options: RatingClaimsWorldOptions = {},
): Promise<RatingClaimsWorld> {
  const base = await ratingClaimsFixture();
  let redis: Redis | undefined;
  try {
    redis = new Redis(redisUrl);
    await redis.ping();
    const prefix = `pospay-test-rating-claims-${base.ids.newId()}`;
    const rawState = redisRatingClaimState({
      prefix,
      redis,
      ...limitsOf(options.state),
    });
    const state = tracedState(rawState);
    const tokens = { allow: (): boolean => options.tokens === true };
    const claimTrap: ClaimTrap = { failBefore: new Set<string>() };
    const txTrap: TransactionTrap = { lostReplies: new Set<string>() };
    const claim = buildClaim(base, claimTrap, tokens);
    const transactions = buildTransactions(ratingClaimTransactions(base.db), txTrap);
    const diagnostics = recordingDiagnostics();
    const budget = options.budget ?? { forward: 75, retry: 25 };
    const branchId = await base.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
    base.clock.at = CLOCK_AT;
    await openRatingRequests(base);
    const worker = workerFactory(base, state.port, claim, transactions, diagnostics, budget);
    const parts: WorldParts = {
      base,
      company: TENANT.A.company,
      otherCompany: TENANT.B.company,
      otherBusiness: TENANT.B.business,
      branchId,
      redis,
      prefix,
      rawState,
      state,
      transactions,
      diagnostics,
      tokens,
      claimTrap,
      txTrap,
      budget,
    };
    return buildWorld(parts, worker);
  } catch (error) {
    // الإعداد وقع في النص: اللي اتفتح لازم يتقفل، وإلا اتصالاته بتتسرّب على الاختبارات اللي بعده.
    if (redis !== undefined) await closeRedis(redis).catch(() => undefined);
    await base.close().catch(() => undefined);
    throw error;
  }
}
