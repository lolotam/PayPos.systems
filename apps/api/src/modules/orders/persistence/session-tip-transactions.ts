import {
  IdempotencyKeyReusedError,
  appendAuditLog,
  appendOutboxEvent,
  runIdempotent,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { SessionError } from '../domain/session-error.ts';
import type {
  SessionTipsAuditEntry,
  SessionTipsTransaction,
  SessionTipsTransactions,
} from '../ports/session-tips.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { performerCheck } from './performer-check.adapter.ts';
import { sessionPlace } from './session-place.adapter.ts';
import { sessionRecordAccess } from './session-record-access.adapter.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';
import { sessionTipsRepository } from './session-tip-records.ts';

const TIP_OPERATION = 'record-session-tips';
const REVISION_CONFLICT = 'session_tip_revisions_session_revision_uq';

export function createSessionTipsTransactions(database: TenantWrappers): SessionTipsTransactions {
  return { run: (context, work) => runSessionTips(database, context, work) };
}

async function runSessionTips<T>(
  database: TenantWrappers,
  context: SessionWriteContext,
  work: (tx: SessionTipsTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.withTenant(
      context.companyId,
      (tx) => work(sessionTipsTransaction(tx, context)),
      { userId: context.userId },
    );
  } catch (error) {
    return mapSessionTipsError(error);
  }
}

function sessionTipsTransaction(tx: Tx, context: SessionWriteContext): SessionTipsTransaction {
  const scope = {
    companyId: context.companyId,
    businessId: context.businessId,
    branchId: context.branchId,
  };
  const transaction = {
    access: sessionRecordAccess(
      tx,
      context.companyId,
      context.userId,
      context.businessId,
      context.branchId,
    ),
    performers: performerCheck(tx, context.companyId, context.businessId, context.branchId),
    tips: sessionTipsRepository(tx, scope),
    place: sessionPlace(tx, context.companyId, context.businessId, context.branchId),
    idempotent: <T>(handler: () => Promise<T>) => claimSessionTips(tx, context, handler),
    audit: (id: string, entry: SessionTipsAuditEntry) => appendAuditLog(tx, id, entry),
    emit: (id: string, sessionId: string, payload: unknown) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'service_session',
        aggregateId: sessionId,
        eventType: 'SessionTipsChanged',
        payload,
      }),
  };
  return transaction;
}

async function claimSessionTips<T>(
  tx: Tx,
  context: SessionWriteContext,
  handler: () => Promise<T>,
) {
  const result = await runIdempotent(
    tx,
    {
      scope: 'COMPANY',
      operation: TIP_OPERATION,
      key: context.key,
      fingerprint: context.fingerprint,
    },
    async () => ({ status: 200, body: await handler() }),
  );
  return { body: result.body as T, replayed: result.replayed };
}

function mapSessionTipsError(error: unknown): never {
  if (error instanceof IdempotencyKeyReusedError) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
  // التعارض 23505 يصل بعد إجهاض المعاملة، فقراءة current_revision غير ممكنة ويبقى الرفض بلا تفاصيل.
  if (isRevisionConflict(error)) throw new SessionError('TIP_REVISION_CONFLICT');
  cleanSessionWrite(error);
}

function isRevisionConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (
    let current = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    const node = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
    const constraint = node.constraint_name ?? node.constraint;
    if (String(node.code) === '23505' && constraint === REVISION_CONFLICT) return true;
  }
  return false;
}
