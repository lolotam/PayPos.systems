import { appendAuditLog, appendOutboxEvent, type IdGenerator, type Tx } from '@pospay/db';

import type { AuditTrail } from '../ports/audit-trail.port.ts';
import type { OutboxWriter } from '../ports/outbox-writer.port.ts';

/**
 * The outbox and audit writers bound to one transaction. Persistence code builds them inside
 * `withTenant(…, tx => …)` and hands them to the use case, which never sees the Tx.
 *
 * @param tx  the transaction the use case runs in
 * @param ids the UUID v7 generator
 * @returns the two ports, writing into `tx`
 */
export function transactionWriters(
  tx: Tx,
  ids: IdGenerator,
): { outbox: OutboxWriter; audit: AuditTrail } {
  return {
    outbox: { append: (event) => appendOutboxEvent(tx, ids.newId(), event) },
    audit: { record: (entry) => appendAuditLog(tx, ids.newId(), entry) },
  };
}
