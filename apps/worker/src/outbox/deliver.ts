import {
  markEventConsumed,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
} from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';

import type { OutboxConsumer } from './consumer.ts';
import { retryDelayMs } from './retry-policy.ts';

/**
 * Builds the dispatcher's `deliver`: every consumer of the event's type applies it once, each in its own
 * tenant transaction with its dedupe row. A consumer's failure becomes a retry or a park — never a throw,
 * which the dispatcher reserves for its own crash. Consumers that already succeeded are skipped on the
 * retry by their dedupe rows.
 *
 * @param app       the pospay_app database (only withTenant is used)
 * @param consumers the registered consumers
 * @param logger    the worker logger
 * @returns the deliver function for dispatchBatch
 */
export function createDeliverer(
  app: Pick<Database, 'withTenant'>,
  consumers: readonly OutboxConsumer[],
  logger: Logger,
): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  return async (event) => {
    try {
      for (const consumer of consumers) {
        if (!consumer.eventTypes.includes(event.eventType)) continue;
        await app.withTenant(event.companyId, async (tx) => {
          if (await markEventConsumed(tx, consumer.id, event.id)) await consumer.handle(tx, event);
        });
      }
      return { delivered: true };
    } catch (error) {
      const attempt = event.attempts + 1;
      const retryInMs = retryDelayMs(attempt);
      // Type and code only — an error message can carry payload data (same rule as the logs).
      const { type, code } = errorDiagnostic(error) as { type: string; code?: string };
      const fields = {
        event: { id: event.id, type: event.eventType, companyId: event.companyId },
        attempt,
        err: error,
      };
      if (retryInMs === null) logger.error(fields, 'outbox event parked');
      else logger.warn(fields, 'outbox delivery failed');
      return { delivered: false, error: code === undefined ? type : `${type}:${code}`, retryInMs };
    }
  };
}
