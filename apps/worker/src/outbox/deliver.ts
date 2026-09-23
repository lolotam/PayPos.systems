import {
  markEventConsumed,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
} from '@pospay/db';
import { errorDiagnostic, type Logger } from '@pospay/observability';

import type { OutboxConsumer } from './consumer.ts';
import { retryDelayMs } from './retry-policy.ts';

const GRACE_MS = 1_000;

// Named TimeoutError, a name the log diagnostics already recognise, so last_error says what happened.
const deliveryTimeout = (): Error =>
  Object.assign(new Error('delivery timed out'), { name: 'TimeoutError' });

/**
 * Builds the dispatcher's `deliver`: every consumer of the event's type applies it once, each in its own
 * tenant transaction with its dedupe row. A consumer's failure becomes a retry or a park — never a throw,
 * which the dispatcher reserves for its own crash. Consumers that already succeeded are skipped on the
 * retry by their dedupe rows.
 *
 * A delivery gets `timeoutMs` in total. Each consumer transaction runs with the time left as a server-side limit
 * (withTenant timeoutMs), so a slow statement is cancelled and a stalled transaction is closed without committing;
 * no consumer starts once the time is up, and the attempt counts as failed. Consumers do database work only
 * (plan v4 T7b): a handler awaiting something else cannot be cancelled from outside.
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
  const applyAll = async (event: ClaimedEvent, endsAt: number): Promise<void> => {
    for (const consumer of consumers) {
      if (!consumer.eventTypes.includes(event.eventType)) continue;
      const left = endsAt - Date.now();
      if (left < 1) throw deliveryTimeout();
      await app.withTenant(
        event.companyId,
        async (tx) => {
          if (await markEventConsumed(tx, consumer.id, event.id)) await consumer.handle(tx, event);
        },
        { timeoutMs: left },
      );
    }
  };
  return async (event) => {
    const endsAt = Date.now() + timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    // The server-side limits end the transaction; this deadline, a little later, ends the wait for a handler
    // that is stuck in JavaScript, so the batch can record the failure.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(deliveryTimeout()), timeoutMs + GRACE_MS);
    });
    try {
      await Promise.race([applyAll(event, endsAt), deadline]);
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
