import { sql } from 'drizzle-orm';

import { toJsonb } from './outbox.ts';
import type { Tx } from './with-tenant.ts';

/**
 * طلب بـ Idempotency-Key. الـ scope بيحدد مين صاحب المفتاح: COMPANY لكل كتابة جوه شركة،
 * USER لكتابة قبل ما الشركة توجد (onboard-company). الـ id بتاع الـ scope بييجي من الـ context مش من هنا.
 */
export interface IdempotencyRequest {
  readonly scope: 'COMPANY' | 'USER';
  /** kebab-case: onboard-company, create-business… */
  readonly operation: string;
  /** اللي العميل بعته في الـ header: ASCII ظاهر، 1–255 حرف. */
  readonly key: string;
  /** sha256 hex للطلب (method + route + body) — بيحسبه الـ API. */
  readonly fingerprint: string;
  /** أقصى انتظار لطلب مكرر شغال في نفس اللحظة؛ الافتراضي 5 ثواني. */
  readonly lockTimeoutMs?: number;
}

/**
 * الرد اللي بيتخزن وبيترجع زي ما هو لأي retry بنفس المفتاح.
 */
export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * الرد، ومعاه هل ده replay لرد متخزن ولا تنفيذ جديد.
 */
export interface IdempotentResult extends StoredResponse {
  readonly replayed: boolean;
}

/**
 * نفس المفتاح اتبعت بطلب مختلف — بيترفض (422) بدل ما يرجّع رد طلب تاني.
 */
export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('Idempotency-Key was already used with a different request');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/**
 * طلب بنفس المفتاح لسه شغال وخلص وقت الانتظار — الـ transaction اترجعت، والعميل يعيد (409).
 */
export class IdempotencyKeyBusyError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('A request with this Idempotency-Key is still in progress', options);
    this.name = 'IdempotencyKeyBusyError';
  }
}

const KEY = /^[!-~]{1,255}$/;
const OPERATION = /^[a-z][a-z0-9-]{1,62}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const RETENTION = '24 hours';
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const LOCK_NOT_AVAILABLE = '55P03';

// drizzle بيلف خطأ postgres.js جوه DrizzleQueryError، فالـ code ممكن يبقى في الخطأ نفسه أو في الـ cause.
const isLockTimeout = (error: unknown): boolean => {
  for (let current = error, depth = 0; current !== undefined && depth < 5; depth += 1) {
    if ((current as { code?: unknown }).code === LOCK_NOT_AVAILABLE) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

function validate(request: IdempotencyRequest): number {
  if (!KEY.test(request.key)) throw new TypeError('key must be 1–255 visible ASCII characters');
  if (!OPERATION.test(request.operation)) throw new TypeError('operation must be kebab-case');
  if (!FINGERPRINT.test(request.fingerprint)) throw new TypeError('fingerprint must be sha256 hex');
  const timeout = request.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1) throw new TypeError('lockTimeoutMs must be > 0');
  return timeout;
}

// الـ claim: INSERT … ON CONFLICT DO NOTHING. لو فيه transaction تانية عاملة claim لنفس المفتاح ولسه
// مخلصتش، الـ INSERT ده بيستنى عليها — lock_timeout بيحدد الانتظار ده بس، وبعده بيرجع لـ DEFAULT.
async function claim(tx: Tx, request: IdempotencyRequest, timeoutMs: number): Promise<boolean> {
  const company = request.scope === 'COMPANY' ? sql`app_company_id()` : sql`NULL`;
  await tx.execute(sql`SELECT set_config('lock_timeout', ${`${timeoutMs}ms`}, true)`);
  try {
    const rows = await tx.execute(sql`
      INSERT INTO idempotency_keys
        (scope_type, scope_id, company_id, user_id, operation, key, request_fingerprint, expires_at)
      VALUES (${request.scope},
              ${request.scope === 'COMPANY' ? sql`app_company_id()` : sql`app_user_id()`},
              ${company}, app_user_id(), ${request.operation}, ${request.key},
              ${request.fingerprint}, now() + ${RETENTION}::interval)
      ON CONFLICT DO NOTHING
      RETURNING 1 AS claimed`);
    return rows.length === 1;
  } catch (error) {
    if (isLockTimeout(error)) throw new IdempotencyKeyBusyError({ cause: error });
    throw error;
  } finally {
    await tx.execute(sql`SET LOCAL lock_timeout TO DEFAULT`).catch(() => undefined);
  }
}

const keyMatch = (request: IdempotencyRequest) => sql`
  scope_type = ${request.scope}
  AND scope_id = ${request.scope === 'COMPANY' ? sql`app_company_id()` : sql`app_user_id()`}
  AND operation = ${request.operation} AND key = ${request.key}`;

/**
 * بينفّذ الـ handler مرة واحدة بس لكل مفتاح، جوه الـ transaction بتاعة الـ caller (plan v4 T7):
 * الـ claim والتأثير والـ outbox والرد المتخزن بيتعملوا commit مع بعض أو rollback مع بعض.
 * - مفتاح جديد: الـ handler بيشتغل ورده بيتخزن.
 * - مفتاح متخزن بنفس الطلب: الرد المتخزن بيرجع زي ما هو، والـ handler مبيشتغلش.
 * - مفتاح متخزن بطلب مختلف: IdempotencyKeyReusedError.
 * - طلب مكرر شغال في نفس اللحظة: بيستنى؛ لو الأول عمل commit بيرجّع رده، لو عمل rollback بيكمّل هو
 *   كأنه الأول، ولو الانتظار عدّى lockTimeoutMs: IdempotencyKeyBusyError والـ transaction لازم ترجع.
 *
 * @param tx      transaction من withTenant (COMPANY) أو withNewTenant / withUser (USER)
 * @param request الـ scope والعملية والمفتاح والـ fingerprint
 * @param handler التأثير نفسه — بيكتب في نفس الـ tx ويرجّع الرد
 * @returns الرد، وهل هو replay
 */
export async function runIdempotent(
  tx: Tx,
  request: IdempotencyRequest,
  handler: () => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  const timeoutMs = validate(request);
  if (await claim(tx, request, timeoutMs)) {
    const response = await handler();
    await tx.execute(sql`
      UPDATE idempotency_keys
      SET response_status = ${response.status},
          response_body = ${toJsonb(response.body ?? null, 'response body')}::jsonb
      WHERE ${keyMatch(request)}`);
    return { ...response, replayed: false };
  }
  // statement جديدة = snapshot جديدة في READ COMMITTED، فبتشوف الصف اللي الطلب الأول عمله commit.
  const [stored] = await tx.execute<{
    fingerprint: string;
    status: number | null;
    body: unknown;
  }>(sql`
    SELECT request_fingerprint AS fingerprint, response_status AS status, response_body AS body
    FROM idempotency_keys WHERE ${keyMatch(request)}`);
  if (stored === undefined || stored.status === null) {
    throw new Error('Idempotency key conflicted but no stored response is visible');
  }
  if (stored.fingerprint !== request.fingerprint) throw new IdempotencyKeyReusedError();
  return { status: stored.status, body: stored.body, replayed: true };
}
