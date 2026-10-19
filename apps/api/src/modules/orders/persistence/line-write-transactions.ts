import {
  IdempotencyKeyReusedError,
  appendAuditLogs,
  appendOutboxEvent,
  runIdempotent,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { SessionError } from '../domain/session-error.ts';
import type { LineEditAuditEntry } from '../ports/line-edit.port.ts';
import type { SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { cleanSessionWrite } from './session-recovery-proof.ts';

interface LineWriteEffects {
  idempotent<T>(handler: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  audit(id: string, entry: LineEditAuditEntry): Promise<void>;
  emit(id: string, sessionId: string, payload: unknown): Promise<void>;
}

export function createLineWriteTransactions<TBody extends object>(
  database: TenantWrappers,
  operation: string,
  assemble: (tx: Tx, context: SessionWriteContext) => TBody,
): { run<T>(context: SessionWriteContext, work: (tx: TBody & LineWriteEffects) => Promise<T>): Promise<T> } {
  return { run: (context, work) => runLineWrite(database, operation, assemble, context, work) };
}

async function runLineWrite<TBody extends object, T>(
  database: TenantWrappers,
  operation: string,
  assemble: (tx: Tx, context: SessionWriteContext) => TBody,
  context: SessionWriteContext,
  work: (tx: TBody & LineWriteEffects) => Promise<T>,
): Promise<T> {
  try {
    return await database.withTenant(
      context.companyId,
      (tx) => work({ ...assemble(tx, context), ...lineWriteEffects(tx, context, operation) }),
      { userId: context.userId },
    );
  } catch (error) {
    return mapLineWriteError(error);
  }
}

function lineWriteEffects(tx: Tx, context: SessionWriteContext, operation: string): LineWriteEffects {
  return {
    idempotent: (handler) => claimLineWrite(tx, context, operation, handler),
    audit: (id, entry) => writeLineAudit(tx, id, entry),
    emit: (id, sessionId, payload) => appendOutboxEvent(tx, id, {
      aggregateType: 'service_session',
      aggregateId: sessionId,
      eventType: 'ServiceLineChanged',
      payload,
    }),
  };
}

async function claimLineWrite<T>(tx: Tx, context: SessionWriteContext, operation: string, handler: () => Promise<T>) {
  const result = await runIdempotent(tx, {
    scope: 'COMPANY',
    operation,
    key: context.key,
    fingerprint: context.fingerprint,
  }, async () => ({ status: 200, body: await handler() }));
  return { body: result.body as T, replayed: result.replayed };
}

async function writeLineAudit(tx: Tx, id: string, entry: LineEditAuditEntry): Promise<void> {
  await appendAuditLogs(tx, [{ id, entry }]);
}

function mapLineWriteError(error: unknown): never {
  if (error instanceof IdempotencyKeyReusedError) throw new SessionError('IDEMPOTENCY_KEY_REUSED');
  cleanSessionWrite(error);
}
