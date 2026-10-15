import { appendOutboxEvent, runIdempotent, type TenantWrappers, type Tx, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { sessionBatchEvent } from '../domain/session-write.ts';
import type { Clock, ServiceSessionTransactions, SessionTransaction, SessionWriteContext } from '../ports/service-session-transactions.port.ts';
import { insertLines, insertSession } from './session-writes.ts';
import { loadSession } from './session-records.ts';
import { auditSession } from './session-audit.ts';
import { cleanSessionWrite, linkCommittedProof } from './session-recovery-proof.ts';

export type SessionReaders = Pick<SessionTransaction, 'place' | 'access' | 'catalog' | 'customer' | 'performers' | 'discount' | 'discountMessages'>;

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
    } catch (error) { cleanSessionWrite(error); }
  } };
}
