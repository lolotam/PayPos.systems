import { createHash } from 'node:crypto';
import { IdempotencyKeyBusyError, IdempotencyKeyReusedError, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
import { SessionError } from '../domain/session-error.ts';
import type {
  SessionRecoveryIssue,
  SessionRecoveryOperation,
} from '../ports/session-recovery.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';

/** هاش المفتاح فقط؛ الصف لا يحتفظ بـ Idempotency-Key الخام. */
export function recoveryKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const RETRYABLE_SQLSTATE = new Set(['40P01', '40001', '55P03']);

// 55P03 و40001 في إصدار الإثبات يبقى 503: الصف لم يُلتزم، والعميل يعيد نفس المفتاح.
// في معاملة المال يصبح TRANSACTION_RETRY_REQUIRED لأن الإثبات التزم قبلها.
// 55P03 داخل claim المفتاح يبقى IdempotencyKeyBusyError ولا يُترجم مرة ثانية.
function mapSessionPersistenceError(
  error: unknown,
  visit: (node: object, depth: number) => void,
  otherwise: () => never,
): never {
  const seen = new Set<unknown>();
  let depth = 0;
  for (
    let current = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    visit(current, depth);
    depth += 1;
  }
  return otherwise();
}

export function refuseRecoveryIssue(error: unknown): never {
  return mapSessionPersistenceError(
    error,
    (node) => {
      if (node instanceof SessionError) throw node;
    },
    () => {
      throw new ApiError('SESSION_RECOVERY_UNAVAILABLE');
    },
  );
}

export function cleanSessionWrite(error: unknown): never {
  return mapSessionPersistenceError(
    error,
    (node, depth) => {
      if (
        depth === 0 &&
        (node instanceof SessionError ||
          node instanceof IdempotencyKeyBusyError ||
          node instanceof IdempotencyKeyReusedError)
      ) {
        throw node;
      }
      const code = String((node as { code?: unknown }).code);
      if (RETRYABLE_SQLSTATE.has(code)) throw new SessionError('TRANSACTION_RETRY_REQUIRED');
    },
    () => {
      throw new Error('SESSION_PERSISTENCE_FAILED');
    },
  );
}

interface ProofIdentity {
  userId: string;
  businessId: string;
  branchId: string;
  operation: SessionRecoveryOperation;
  key: string;
}

function proofIdentity(identity: ProofIdentity) {
  const hash = recoveryKeyHash(identity.key);
  return sql`company_id = app_company_id() AND user_id = ${identity.userId}
    AND business_id = ${identity.businessId} AND branch_id = ${identity.branchId}
    AND operation = ${identity.operation} AND key_hash = ${hash}`;
}

export interface RecoveryProofDates {
  businessDate: string;
  timezone: string;
  sessionId: string | null;
}

export async function loadProof(
  tx: Tx,
  input: SessionRecoveryIssue,
): Promise<RecoveryProofDates | undefined> {
  const [row] = await tx.execute<{
    business_date: string;
    business_timezone: string;
    session_id: string | null;
  }>(sql`
    SELECT to_char(business_date,'YYYY-MM-DD') AS business_date, business_timezone, session_id
    FROM service_session_recoveries
    WHERE ${proofIdentity(input)}`);
  return row === undefined
    ? undefined
    : {
        businessDate: row.business_date,
        timezone: row.business_timezone,
        sessionId: row.session_id,
      };
}

function committedSessionId(body: unknown): string {
  const session =
    typeof body === 'object' && body !== null ? (body as { session?: unknown }).session : null;
  const id =
    typeof session === 'object' && session !== null ? (session as { id?: unknown }).id : null;
  if (typeof id !== 'string' || id === '') throw new Error('SESSION_PERSISTENCE_FAILED');
  return id;
}

export async function linkCommittedProof(
  tx: Tx,
  context: SessionWriteContext,
  operation: SessionRecoveryOperation,
  body: unknown,
  at: Date,
): Promise<void> {
  const sessionId = committedSessionId(body);
  const stamp = at.toISOString();
  await tx.execute(sql`
    UPDATE service_session_recoveries SET session_id = ${sessionId}, committed_at = ${stamp}::timestamptz
    WHERE ${proofIdentity({
      userId: context.userId,
      businessId: context.businessId,
      branchId: context.branchId,
      operation,
      key: context.key,
    })}
      AND revoked_at IS NULL AND expires_at > ${stamp}::timestamptz AND committed_at IS NULL
      AND EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id = app_company_id()
        AND s.business_id = service_session_recoveries.business_id
        AND s.branch_id = service_session_recoveries.branch_id AND s.id = ${sessionId})`);
}
