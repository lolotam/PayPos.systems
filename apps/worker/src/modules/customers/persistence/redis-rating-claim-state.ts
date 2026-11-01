import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';

import {
  FORWARD_VISITS,
  LEASE_MS,
  MAX_TURN_MS,
  PAGE_RESERVE_BYTES,
  RETRY_BACKOFF_MS,
  RETRY_CAPACITY,
  STATE_MAX_BYTES,
} from '../domain/rating-claim-scheduling.ts';
import type {
  ClaimStateFence,
  ClaimStateReservations,
  ClaimStateResult,
  ClaimStateSnapshot,
  RatingClaimState,
} from '../ports/rating-claim-state.port.ts';
import {
  decodeReservations,
  decodeState,
  parse,
  type DecodedReply,
} from './redis-rating-claim-state.codec.ts';
import { RATING_CLAIM_STATE_ACQUIRE } from './rating-claim-state-acquire.lua.ts';
import { RATING_CLAIM_STATE_LEASE } from './rating-claim-state-lease.lua.ts';
import { RATING_CLAIM_STATE_RESERVE } from './rating-claim-state-reserve.lua.ts';
import { RATING_CLAIM_STATE_SETTLE } from './rating-claim-state-settle.lua.ts';
import { RATING_CLAIM_STATE_SWEEP } from './rating-claim-state-sweep.lua.ts';

const ACQUIRE = RATING_CLAIM_STATE_ACQUIRE;
const LEASE = RATING_CLAIM_STATE_LEASE;
const RESERVE = RATING_CLAIM_STATE_RESERVE;
const SETTLE = RATING_CLAIM_STATE_SETTLE;
const SWEEP = RATING_CLAIM_STATE_SWEEP;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = /^[^\s{}]+$/;
const digests = new Map<string, string>();

/** إعدادات منفذ حالة الجدولة: البادئة والعميل، والحدود التقنية قابلة للتغيير للاختبار. */
export interface RatingClaimStateOptions {
  readonly prefix: string;
  readonly redis: Redis;
  readonly capacity?: number;
  readonly leaseMs?: number;
  readonly maxTurnMs?: number;
  readonly backoffMs?: number;
  readonly maxBytes?: number;
  readonly reserveBytes?: number;
}

interface StateLimits {
  readonly leaseMs: number;
  readonly maxTurnMs: number;
  readonly maxBytes: number;
}

interface StateContext {
  readonly limits: StateLimits;
  readonly capacity: number;
  readonly backoffMs: number;
  readonly reserveBytes: number;
  readonly serial: <T>(work: () => Promise<T>) => Promise<T>;
  readonly fenceOf: (fence: ClaimStateFence, extra: Record<string, unknown>) => Record<string, unknown>;
  readonly call: (
    script: string,
    companyId: string,
    envelope: Record<string, unknown>,
  ) => Promise<ClaimStateResult<ClaimStateSnapshot>>;
  readonly reserve: (
    fence: ClaimStateFence,
    limit: number,
    workTokens: readonly string[],
  ) => Promise<ClaimStateResult<ClaimStateReservations>>;
}

function isNoScript(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}

function stateKey(prefix: string, companyId: string): string {
  if (!PREFIX.test(prefix)) throw new TypeError('RATING_CLAIM_STATE_PREFIX_INVALID');
  if (!UUID.test(companyId)) throw new TypeError('RATING_CLAIM_STATE_COMPANY_INVALID');
  return `${prefix}:rating-claims:v1:{${companyId}}:state`;
}

function token(value: string, name: string): string {
  if (typeof value !== 'string' || value === '') throw new TypeError(`RATING_CLAIM_STATE_${name}_INVALID`);
  return value;
}

function shaOf(script: string): string {
  const cached = digests.get(script);
  if (cached !== undefined) return cached;
  const digest = createHash('sha1').update(script).digest('hex');
  digests.set(script, digest);
  return digest;
}

function commandQueue(): StateContext['serial'] {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = chain.then(work, work);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

function fenceEnvelope(
  fence: ClaimStateFence,
  limits: StateLimits,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  if (!UUID.test(fence.companyId)) throw new TypeError('RATING_CLAIM_STATE_COMPANY_INVALID');
  token(fence.incarnation, 'INCARNATION');
  token(fence.ownerToken, 'OWNER');
  if (!Number.isSafeInteger(fence.expectedVersion) || fence.expectedVersion < 0) {
    throw new TypeError('RATING_CLAIM_STATE_VERSION_INVALID');
  }
  return {
    companyId: fence.companyId,
    incarnation: fence.incarnation,
    version: fence.expectedVersion,
    ownerToken: fence.ownerToken,
    ...limits,
    ...extra,
  };
}

function buildContext(options: RatingClaimStateOptions): StateContext {
  const { redis, prefix } = options;
  const limits: StateLimits = {
    leaseMs: options.leaseMs ?? LEASE_MS,
    maxTurnMs: options.maxTurnMs ?? MAX_TURN_MS,
    maxBytes: options.maxBytes ?? STATE_MAX_BYTES,
  };
  const execute = async (
    script: string,
    companyId: string,
    envelope: Record<string, unknown>,
  ): Promise<DecodedReply> => {
    const key = stateKey(prefix, companyId);
    const payload = JSON.stringify(envelope);
    const sha = shaOf(script);
    try {
      return parse(await redis.evalsha(sha, 1, key, payload));
    } catch (error) {
      if (!isNoScript(error)) throw error;
      return parse(await redis.eval(script, 1, key, payload));
    }
  };
  const fenceOf = (fence: ClaimStateFence, extra: Record<string, unknown>): Record<string, unknown> =>
    fenceEnvelope(fence, limits, extra);
  return {
    limits,
    capacity: options.capacity ?? RETRY_CAPACITY,
    backoffMs: options.backoffMs ?? RETRY_BACKOFF_MS,
    reserveBytes: options.reserveBytes ?? PAGE_RESERVE_BYTES,
    serial: commandQueue(),
    fenceOf,
    call: async (script, companyId, envelope) => {
      const reply = await execute(script, companyId, envelope);
      if (reply.value === undefined) return { code: reply.code, version: reply.version };
      return { code: reply.code, version: reply.version, value: decodeState(reply.value) };
    },
    reserve: async (fence, limit, workTokens) => {
      const reply = await execute(RESERVE, fence.companyId, fenceOf(fence, {
        action: 'reserveRetries',
        limit,
        workTokens: [...workTokens],
      }));
      if (reply.value === undefined) return { code: reply.code, version: reply.version };
      return { code: reply.code, version: reply.version, value: decodeReservations(reply.value) };
    },
  };
}

function ownershipCommands(
  context: StateContext,
): Pick<RatingClaimState, 'acquire' | 'renew' | 'release'> {
  return {
    acquire: (companyId, newIncarnation, ownerToken) => {
      token(newIncarnation, 'INCARNATION');
      token(ownerToken, 'OWNER');
      return context.call(ACQUIRE, companyId, {
        companyId,
        incarnation: newIncarnation,
        ownerToken,
        ...context.limits,
      });
    },
    renew: (fence) =>
      context.serial(() => context.call(LEASE, fence.companyId, context.fenceOf(fence, { action: 'renew' }))),
    release: (fence) =>
      context.serial(() => context.call(LEASE, fence.companyId, context.fenceOf(fence, { action: 'release' }))),
  };
}

function sweepCommands(
  context: StateContext,
): Pick<RatingClaimState, 'begin' | 'enrollPage' | 'finish'> {
  return {
    begin: (fence, sweepId, upperId) =>
      context.call(
        SWEEP,
        fence.companyId,
        context.fenceOf(fence, { action: 'begin', sweepId, upperId: upperId ?? undefined }),
      ),
    enrollPage: (fence, sweepId, fromId, pageId, entries, exhausted) =>
      context.call(
        SWEEP,
        fence.companyId,
        context.fenceOf(fence, {
          action: 'enrollPage',
          sweepId,
          fromId: fromId ?? undefined,
          pageId,
          entries: entries.map((entry) => ({
            requestId: entry.requestId,
            workToken: entry.workToken,
          })),
          exhausted,
          maxEntries: FORWARD_VISITS,
        }),
      ),
    finish: (fence, sweepId) =>
      context.serial(() =>
        context.call(SWEEP, fence.companyId, context.fenceOf(fence, { action: 'finish', sweepId })),
      ),
  };
}

function retryCommands(
  context: StateContext,
): Pick<RatingClaimState, 'reserveRetries' | 'settlePage' | 'settleRetry' | 'read'> {
  const settle = (
    action: 'settlePage' | 'settleRetry',
    fence: ClaimStateFence,
    target: Record<string, unknown>,
    workToken: string,
    settlement: string,
    storedDueAt: Date | null | undefined,
  ): Promise<ClaimStateResult<ClaimStateSnapshot>> =>
    context.serial(() =>
      context.call(SETTLE, fence.companyId, context.fenceOf(fence, {
        action,
        ...target,
        workToken,
        settlement,
        storedDueAt:
          storedDueAt === undefined || storedDueAt === null ? undefined : storedDueAt.getTime(),
        capacity: context.capacity,
        backoffMs: context.backoffMs,
        reserveBytes: context.reserveBytes,
      })),
    );
  return {
    reserveRetries: (fence, limit, workTokens) =>
      context.serial(() => context.reserve(fence, limit, workTokens)),
    settlePage: (fence, pageId, workToken, settlement, storedDueAt) =>
      settle('settlePage', fence, { pageId }, workToken, settlement, storedDueAt),
    settleRetry: (fence, requestId, workToken, settlement, storedDueAt) =>
      settle('settleRetry', fence, { requestId }, workToken, settlement, storedDueAt),
    read: (companyId) => context.call(LEASE, companyId, { companyId, action: 'read', ...context.limits }),
  };
}

/**
 * منفذ حالة الجدولة على Redis: كل تعديل متسور برقم النسخة ورمز المالك، والوقت
 * كله من Redis TIME جوه السكربتات.
 *
 * @param options البادئة والعميل والحدود التقنية
 * @returns منفذ الحالة جاهز للربط في جذر الموديل
 */
export function redisRatingClaimState(options: RatingClaimStateOptions): RatingClaimState {
  const context = buildContext(options);
  return {
    ...ownershipCommands(context),
    ...sweepCommands(context),
    ...retryCommands(context),
  };
}
