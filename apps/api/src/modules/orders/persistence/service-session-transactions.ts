import { appendOutboxEvent, runIdempotent, IdempotencyKeyBusyError, IdempotencyKeyReusedError, type TenantWrappers, type Tx, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { SessionError } from '../domain/session-error.ts';
import { sessionBatchEvent } from '../domain/session-write.ts';
import type { Clock, ServiceSessionTransactions, SessionTransaction, SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { insertLines, insertSession } from './session-writes.ts';
import { loadSession } from './session-records.ts';
import { auditSession } from './session-audit.ts';
import { recoveryKeyHash } from './session-recovery.adapter.ts';

export type SessionReaders = Pick<SessionTransaction, 'place' | 'access' | 'catalog' | 'customer' | 'performers' | 'discount' | 'discountMessages'>;

function cleanError(error: unknown): never {
  if (error instanceof SessionError || error instanceof IdempotencyKeyBusyError || error instanceof IdempotencyKeyReusedError) throw error;
  const seen = new Set<unknown>();
  for (let cause = error; typeof cause === 'object' && cause !== null && !seen.has(cause); cause = (cause as { cause?: unknown }).cause) {
    seen.add(cause);
    if (['40P01', '40001', '55P03'].includes(String((cause as { code?: unknown }).code))) throw new SessionError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('SESSION_PERSISTENCE_FAILED');
}

function committedSessionId(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const session = (body as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null) return undefined;
  const id = (session as { id?: unknown }).id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

async function linkCommittedProof(tx: Tx, context: SessionWriteContext, operation: 'record-service-session' | 'append-service-session-lines', body: unknown, at: Date): Promise<void> {
  const sessionId = committedSessionId(body);
  if (sessionId === undefined) return;
  const stamp = at.toISOString();
  await tx.execute(sql`
    UPDATE service_session_recoveries SET session_id = ${sessionId}, committed_at = ${stamp}::timestamptz
    WHERE company_id = app_company_id() AND user_id = ${context.userId} AND business_id = ${context.businessId}
      AND branch_id = ${context.branchId} AND operation = ${operation} AND key_hash = ${recoveryKeyHash(context.key)}
      AND revoked_at IS NULL AND expires_at > ${stamp}::timestamptz AND committed_at IS NULL
      AND EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id = app_company_id()
        AND s.business_id = service_session_recoveries.business_id AND s.branch_id = service_session_recoveries.branch_id
        AND s.id = ${sessionId})`);
}

export function createServiceSessionTransactions(database: TenantWrappers, ids: IdGenerator,
  bind: (tx: Tx, context: SessionWriteContext) => SessionReaders, clock: Clock): ServiceSessionTransactions {
  return { run: async (context, work) => {
    try {
      return await database.withTenant(context.companyId, async (tx) => work({
        ...bind(tx, context),
        idempotent: async (operation, handler) => {
          const result = await runIdempotent(tx, { scope: 'COMPANY', operation, key: context.key, fingerprint: context.fingerprint },
            async () => ({ status: 201, body: await handler() }));
          await linkCommittedProof(tx, context, operation, result.body, clock.now());
          return { body: result.body as Awaited<ReturnType<typeof handler>>, replayed: result.replayed };
        },
        repository: {
          load: (id) => loadSession(tx, context.companyId, context.businessId, context.branchId, id),
          lock: async (id) => { await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(app_company_id()::text || ':service_session:' || ${id}::uuid::text,0))`); },
          insertSession: (record) => insertSession(tx, context.companyId, record),
          insertLines: (lines) => insertLines(tx, context.companyId, context.businessId, lines),
        },
        audit: (record, lines, outcome, append) => auditSession(tx, ids, record, lines, outcome, append),
        emit: (record, lines, append) => appendOutboxEvent(tx, ids.newId(), { aggregateType: 'service_session', aggregateId: record.id,
          eventType: append ? 'ServiceSessionLinesAdded' : 'ServiceSessionRecorded', payload: sessionBatchEvent(record, lines) }),
      }), { userId: context.userId });
    } catch (error) { cleanError(error); }
  } };
}
