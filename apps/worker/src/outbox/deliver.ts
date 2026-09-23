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
const CONSUMER_ID = /^[a-z][a-z0-9.-]{1,99}$/;
/** One delivery's whole budget; shutdown waits longer than this (worker.ts). */
export const DELIVERY_TIMEOUT_MS = 60_000;

// TypeError: a known diagnostic name; last_error then reads 'TypeError' for an event this version cannot place.
const unknownEventType = (): Error => new TypeError('unknown event type');

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
 * An event type this worker does not know is never acknowledged: during a rolling deploy an older worker
 * may claim an event a newer version introduced, and publishing it here would skip its new handler forever.
 * It fails like any delivery — with backoff, so a newer worker takes it — and is parked if none ever does.
 *
 * @param app       the pospay_app database (only withTenant is used)
 * @param consumers the registered consumers
 * @param logger    the worker logger
 * @param options   the event types this worker knows (with or without a consumer), and the delivery budget
 * @param options.knownEventTypes every event type published in this version, consumed or not
 * @param options.timeoutMs       how long one delivery may take; must stay below the dispatcher's lease
 * @returns the deliver function for dispatchBatch
 */
export function createDeliverer(
  app: Pick<Database, 'withTenant'>,
  consumers: readonly OutboxConsumer[],
  logger: Logger,
  options: { knownEventTypes: readonly string[]; timeoutMs?: number },
): (event: ClaimedEvent) => Promise<DeliveryOutcome> {
  const timeoutMs = options.timeoutMs ?? DELIVERY_TIMEOUT_MS;
  // Two consumers sharing an id share a dedupe row: the second would see the event as already applied and its
  // effect would be skipped for good. A registration mistake must stop the worker, not lose effects.
  const ids = consumers.map((consumer) => consumer.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate !== undefined) throw new Error(`Two outbox consumers share the id ${duplicate}`);
  // The same format consumed_events.consumer_id enforces: an id the table rejects would fail every delivery
  // and park every event of its type, so it stops the worker at startup instead.
  const invalid = ids.find((id) => !CONSUMER_ID.test(id));
  if (invalid !== undefined)
    throw new Error(`Outbox consumer id ${invalid} is not a valid consumer id`);
  const known = new Set([...options.knownEventTypes, ...consumers.flatMap((c) => c.eventTypes)]);
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
      if (!known.has(event.eventType)) throw unknownEventType();
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
