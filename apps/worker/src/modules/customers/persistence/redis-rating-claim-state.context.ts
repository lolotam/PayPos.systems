import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';

import {
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
} from '../ports/rating-claim-state.port.ts';
import {
  decodeReservations,
  decodeState,
  parse,
  type DecodedReply,
} from './redis-rating-claim-state.codec.ts';
import { RATING_CLAIM_STATE_RESERVE } from './rating-claim-state-reserve.lua.ts';

const RESERVE = RATING_CLAIM_STATE_RESERVE;
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

/** الحدود التقنية اللي بتتبعت مع كل أمر: مدة الحجز، وسقف الدور، وحجم الحالة. */
export interface StateLimits {
  readonly leaseMs: number;
  readonly maxTurnMs: number;
  readonly maxBytes: number;
}

/** سياق التنفيذ: الحدود، والسعة، وطرق استدعاء السكربتات على Redis. */
export interface StateContext {
  readonly limits: StateLimits;
  readonly capacity: number;
  readonly backoffMs: number;
  readonly reserveBytes: number;
  readonly serial: <T>(work: () => Promise<T>) => Promise<T>;
  readonly fenceOf: (
    fence: ClaimStateFence,
    extra: Record<string, unknown>,
  ) => Record<string, unknown>;
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

/**
 * بيتأكد إن الرمز نص مش فاضي، لأن رمز فاضي معناه أمر بيمر من غير سور.
 *
 * @param value الرمز اللي بيتحقن
 * @param name اسم الرمز في رسالة الخطأ
 * @returns نفس الرمز
 */
export function token(value: string, name: string): string {
  if (typeof value !== 'string' || value === '')
    throw new TypeError(`RATING_CLAIM_STATE_${name}_INVALID`);
  return value;
}

function shaOf(script: string): string {
  const cached = digests.get(script);
  if (cached !== undefined) return cached;
  const digest = createHash('sha1').update(script).digest('hex');
  digests.set(script, digest);
  return digest;
}

/**
 * بيسلسل الأوامر ورا بعض على نفس المفتاح.
 *
 * الأوامر كلها بتقفل على نفس مفتاح الشركة، فتشغيلها بالتوازي معناه منافسة
 * على النسخة. الطابور بيخلي كل أمر يخلص قبل ما الذي بعده يبدأ.
 */
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

/**
 * خطأ إعداد منفذ الحالة: حدود متناقضة بتخلّي الدور يفقد سوره قبل ما يخلص.
 *
 * كل خطأ تاني في الملف ده TypeError عادي، بس ده خطأ تهيئة بيوقف التشغيل.
 */
export class RatingClaimStateConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatingClaimStateConfigError';
  }
}

/**
 * يبني سياق التنفيذ: الحدود، وطرق استدعاء السكربتات، وطابور الأوامر.
 *
 * الحجز لازم يكون أقصر من سقف الدور: التجديد بيمدّد الحجز، فلو الحجز أطول
 * من السقف ما كانش فيه تجديد يقدر يرجع LIMIT، والدور كان هيفقد سوره بسبب
 * انتهاء الحجز مش بسبب السقف.
 *
 * @param options البادئة والعميل والحدود التقنية
 * @returns سياق جاهز تبني عليه أوامر المنفذ
 */
export function buildContext(options: RatingClaimStateOptions): StateContext {
  const { redis, prefix } = options;
  const limits: StateLimits = {
    leaseMs: options.leaseMs ?? LEASE_MS,
    maxTurnMs: options.maxTurnMs ?? MAX_TURN_MS,
    maxBytes: options.maxBytes ?? STATE_MAX_BYTES,
  };
  if (limits.leaseMs > limits.maxTurnMs) {
    throw new RatingClaimStateConfigError('RATING_CLAIM_STATE_LEASE_EXCEEDS_TURN');
  }
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
  const fenceOf = (
    fence: ClaimStateFence,
    extra: Record<string, unknown>,
  ): Record<string, unknown> => fenceEnvelope(fence, limits, extra);
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
      const reply = await execute(
        RESERVE,
        fence.companyId,
        fenceOf(fence, {
          action: 'reserveRetries',
          limit,
          workTokens: [...workTokens],
        }),
      );
      if (reply.value === undefined) return { code: reply.code, version: reply.version };
      return { code: reply.code, version: reply.version, value: decodeReservations(reply.value) };
    },
  };
}
