// مُنشئ عالم القبول: القاعدة الحقيقية، وRedis الحقيقية، ومهايات المطالبة الحقيقية.
// الاختبار بيقرا من القاعدة والـ Redis بعد كل دور، فالمحاكاة بتفضل في حدود السور بس.
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';

import type { Tx } from '@pospay/db';
import { TENANT, USER } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { createClaimRatingRequest } from '../../modules/customers/index.ts';
import { daySessionsReader } from '../../modules/orders/index.ts';
import { ratingClaimRepository } from '../../modules/customers/persistence/rating-claim.repository.ts';
import { ratingClaimTransactions } from '../../modules/customers/persistence/rating-claim.transactions.ts';
import {
  redisRatingClaimState,
  type RatingClaimStateOptions,
} from '../../modules/customers/persistence/redis-rating-claim-state.ts';
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
import type {
  RatingTokenClaim,
  RatingTokenDeriver,
} from '../../modules/customers/ports/rating-token.port.ts';
import {
  ClaimRatingRequests,
  type RatingClaimsClaim,
  type RatingClaimsTurnSummary,
} from '../../modules/customers/use-cases/claim-rating-requests/claim-rating-requests.ts';
import {
  everyDay,
  ratingClaimsFixture,
  testTokenHash,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';
import {
  seedPlan,
  seedRequests,
  seedVisits,
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

export { BUSINESS_DATE, DUE_AT, SEND_DEADLINE, VISIT_AT } from './rating-claims-rows.fixture.ts';
export type { SeededRows, SeedOptions };
export type { RecordingDiagnostics };

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

/** مواعيد الفرع في الاختبار: كل يوم من العاشرة إلى العاشرة مساءً. */
const KUWAIT = 'Asia/Kuwait';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);

/** ساعة الاختبار: بعد الاستحقاق وقبل الموعد النهائي. */
export const CLOCK_AT = new Date('2026-06-01T14:00:00.000Z');

/** خطّاف المطالبة: الطلبات اللي تفشل قبل التنفيذ، فالمعاملة بترجع وما بتكتبش. */
export interface ClaimTrap {
  readonly failBefore: Set<string>;
}

/** خطّاف المعاملات: الطلبات اللي ضاع رد الـ commit بتاعها بعد ما اتنفّذ. */
export interface TransactionTrap {
  readonly lostReplies: Set<string>;
}

/** صف مزروع في معاملة مفتوحة: الـ commit بيتأجل لحد ما الاختبار يفتحه. */
export interface HeldSeed {
  readonly requestId: string;
  /** بيتحل لما الصف يتكتب فعلاً جوّه المعاملة المفتوحة. */
  readonly inserted: Promise<void>;
  release(): void;
  readonly done: Promise<unknown>;
}

/** قفل صف طلب في معاملة مفتوحة. */
export interface HeldLock {
  readonly locked: Promise<void>;
  release(): void;
  readonly done: Promise<unknown>;
}

/** خيارات عالم القبول. */
export interface RatingClaimsWorldOptions {
  readonly budget?: VisitBudget;
  /** حالة البصمة في البداية: غير متاحة هي الوضع الافتراضي لاختبارات إعادة المحاولة. */
  readonly tokens?: boolean;
  readonly state?: Partial<RatingClaimStateLimits>;
}

/** حدود تقنية للحالة: كل القيم موجودة، عشان ما فيش undefined في خيار اختياري. */
export interface RatingClaimStateLimits {
  readonly capacity: number;
  readonly leaseMs: number;
  readonly maxTurnMs: number;
  readonly backoffMs: number;
  readonly maxBytes: number;
  readonly reserveBytes: number;
}

/** خيارات الموظف: منفذ حالة تاني أو ميزانية تانية أو تشخيص تاني. */
export interface WorkerOptions {
  state?: RatingClaimState;
  budget?: VisitBudget;
  diagnostics?: RatingClaimDiagnostics;
}

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

/** عالم القبول: القاعدة والـ Redis والمهايات، وعلماء يقدرون يشتغلوا بالتوازي. */
export interface RatingClaimsWorld {
  readonly base: RatingClaimsFixture;
  readonly company: string;
  readonly otherCompany: string;
  readonly otherBusiness: string;
  readonly branchId: string;
  readonly redis: Redis;
  readonly prefix: string;
  /** منفذ الحالة الحقيقي من غير خطافات، عشان كل عامل يبني خطافاته عليه. */
  readonly rawState: RatingClaimState;
  readonly state: TracedState;
  readonly transactions: RatingClaimTransactions<Tx>;
  readonly diagnostics: RecordingDiagnostics;
  readonly tokens: { allow(requestId: string): boolean };
  readonly claimTrap: ClaimTrap;
  readonly txTrap: TransactionTrap;
  readonly budget: VisitBudget;
  /** موظف جديد لدور خدمة مستقل برمز مالك خاص بيه. */
  worker(options?: WorkerOptions): ClaimRatingRequests<Tx>;
  turn(worker?: ClaimRatingRequests<Tx>): Promise<RatingClaimsTurnSummary>;
  readState(): Promise<ClaimStateSnapshot>;
  /** حالات الطلبات من القاعدة بعد الدور، مقرونة بمعرّف كل طلب. */
  requestStatuses(): Promise<Map<string, string>>;
  /** معرّفات الطلبات اللي وصلها حدث جاهزية في نفس المعاملة. */
  readyRequestIds(): Promise<string[]>;
  seedDueRequests(options: SeedOptions): Promise<SeededRows>;
  /** يزرع صف طلب في معاملة مفتوحة، والـ commit بيتأجل لحد ما الاختبار يفتحه. */
  holdDueRequest(options: SeedOptions): Promise<HeldSeed>;
  /** يقفل صف طلب في معاملة مفتوحة، عشان نجرّب طلب مقفل في معاملة تانية. */
  holdRequestLock(requestId: string): Promise<HeldLock>;
  close(): Promise<void>;
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

/** بصمة تتبدّل بين متاحة وغير متاحة، زي ما القدرة الحقيقية بتتبدّل. */
function tokenDeriver(tokens: { allow(requestId: string): boolean }): RatingTokenDeriver {
  return {
    claim: (identity) => {
      if (!tokens.allow(identity.ratingRequestId)) {
        return null as unknown as RatingTokenClaim;
      }
      return { tokenHash: testTokenHash(identity.ratingRequestId), keyVersion: 1 };
    },
  };
}

/** مطالبة 2a الحقيقية مع خطّاف الفشل قبل التنفيذ. */
function buildClaim(
  base: RatingClaimsFixture,
  claimTrap: ClaimTrap,
  tokens: { allow(requestId: string): boolean },
): RatingClaimsClaim<Tx> {
  const realClaim = createClaimRatingRequest({
    ids: base.ids,
    clock: base.clock,
    daySessions: daySessionsReader,
    deriver: tokenDeriver(tokens),
  });
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

/** يزرع دفعة طلبات مستحقة مع زياراتها. */
async function seedDueRequestsOf(
  parts: WorldParts,
  options: SeedOptions,
): Promise<SeededRows> {
  const plan = seedPlan(seedTarget(parts), options);
  await seedVisits(parts.base.owner, plan);
  await seedRequests(parts.base.owner, plan);
  return { requestIds: plan.requestIds, customerIds: plan.customerIds };
}

/** يزرع صف طلب في معاملة مفتوحة، والـ commit بيتأجل لحد ما الاختبار يفتحه. */
async function holdDueRequestOf(parts: WorldParts, options: SeedOptions): Promise<HeldSeed> {
  const plan = seedPlan(seedTarget(parts), options);
  const gate = createGate();
  const done = parts.base.owner.begin(async (tx) => {
    await seedVisits(tx, plan);
    await seedRequests(tx, plan);
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
  const redis = new Redis(redisUrl);
  await redis.ping();
  const prefix = `pospay-test-rating-claims-${base.ids.newId()}`;
  const rawState = redisRatingClaimState({
    prefix,
    redis,
    ...limitsOf(options.state),
  });
  const state = tracedState(rawState);
  const tokens = { allow: (_requestId: string): boolean => options.tokens === true };
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
}
