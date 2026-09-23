import {
  markEventConsumed,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
} from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';

import type { OutboxConsumer } from './consumer.ts';
import { retryDelayMs } from './retry-policy.ts';

// Named TimeoutError, a name the log diagnostics already recognise, so last_error says what happened.
const deliveryTimeout = (): Error =>
  Object.assign(new Error('delivery timed out'), { name: 'TimeoutError' });

/**
 * Builds the dispatcher's `deliver`: every consumer of the event's type applies it once, each in its own
 * tenant transaction with its dedupe row. A consumer's failure becomes a retry or a park — never a throw,
 * which the dispatcher reserves for its own crash. Consumers that already succeeded are skipped on the
 * retry by their dedupe rows.
 *
 * A delivery that exceeds `timeoutMs` counts as a failed attempt. Its consumer transaction may still commit
 * later; the dedupe row keeps the retry from applying it twice.
 *
 * @param app       the pospay_app database (only withTenant is used)
 * @param consumers the registered consumers
 * @param logger    the worker logger
 * @param timeoutMs how long one delivery may take; must stay below the dispatcher's lease
 * @returns the deliver function for dispatchBatch
 */
export function createDeliverer(
  app: Pick<Database, 'withTenant'>,
  consumers: readonly OutboxConsumer[],
  logger: Logger,
  timeoutMs = 60_000,
): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  const applyAll = async (event: ClaimedEvent): Promise<void> => {
    for (const consumer of consumers) {
      if (!consumer.eventTypes.includes(event.eventType)) continue;
      await app.withTenant(event.companyId, async (tx) => {
        if (await markEventConsumed(tx, consumer.id, event.id)) await consumer.handle(tx, event);
      });
    }
  };
  return async (event) => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(deliveryTimeout()), timeoutMs);
    });
    try {
      await Promise.race([applyAll(event), deadline]);
      return { delivered: true };
    } catch (error) {
      const attempt = event.attempt;
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
    } finally {
      clearTimeout(timer);
    }
  };
}
