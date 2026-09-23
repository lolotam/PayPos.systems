import type { ClaimedEvent, Tx } from '@pospay/db';

/**
 * A reaction to other modules' events (CLAUDE.md §4.1). `handle` runs as pospay_app inside
 * `withTenant(event.companyId)`, in the same transaction as the consumer's dedupe row — so an event
 * delivered twice is applied once. `id` is stable: renaming it makes old events apply again.
 */
export interface OutboxConsumer {
  readonly id: string;
  readonly eventTypes: readonly string[];
  handle(tx: Tx, event: ClaimedEvent): Promise<void>;
}
