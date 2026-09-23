import type { ClaimedEvent, DeliveryOutcome, OutboxDispatcherDatabase } from '@pospay/db';
import type { Logger } from '@pospay/observability';

import { MAX_ATTEMPTS } from './retry-policy.ts';

const SWEEP_BATCH = 1_000;
const SWEEP_MAX_BATCHES = 100;

export interface DispatchLoopOptions {
  readonly dispatcher: Pick<
    OutboxDispatcherDatabase,
    'dispatchBatch' | 'sweepExpiredIdempotencyKeys'
  >;
  readonly deliver: (event: ClaimedEvent) => Promise<DeliveryOutcome>;
  readonly logger: Logger;
  readonly pollIntervalMs?: number;
  readonly batchSize?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => number;
}

// An event whose every claim crashed is parked by the claim itself; it is logged here like any other park.
const logExhausted =
  (logger: Logger) =>
  (events: readonly ClaimedEvent[]): void => {
    for (const event of events) {
      const fields = { id: event.id, type: event.eventType, companyId: event.companyId };
      logger.error({ event: fields, attempt: event.attempt }, 'outbox event parked');
    }
  };

/**
 * The polling loop: drain the outbox batch by batch, wait, repeat; sweep expired idempotency keys every
 * `sweepIntervalMs`. `stop()` stops scheduling and waits for the batch in flight — shutdown calls it
 * before any pool is closed, so no delivery is cut off half way.
 *
 * @param options the dispatcher facade, the deliver function and timings
 * @returns start and stop
 */
export function createDispatchLoop(options: DispatchLoopOptions): {
  start(): void;
  stop(): Promise<void>;
} {
  const { dispatcher, deliver, logger } = options;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const batchSize = options.batchSize ?? 50;
  const sweepIntervalMs = options.sweepIntervalMs ?? 10 * 60 * 1000;
  const now = options.now ?? Date.now;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;
  let lastSweep = now();

  // Batch after batch until one comes back short, so cleanup keeps up with any request rate; capped per cycle
  // so one sweep never starves delivery.
  const sweepIfDue = async (): Promise<void> => {
    if (stopped || now() - lastSweep < sweepIntervalMs) return;
    lastSweep = now();
    let swept = 0;
    for (let batch = 0; batch < SWEEP_MAX_BATCHES && !stopped; batch += 1) {
      const deleted = await dispatcher.sweepExpiredIdempotencyKeys(SWEEP_BATCH);
      swept += deleted;
      if (deleted < SWEEP_BATCH) break;
    }
    logger.info({ swept }, 'idempotency keys swept');
  };

  const dispatchOptions = { maxAttempts: MAX_ATTEMPTS, onExhausted: logExhausted(logger) };

  const tick = async (): Promise<void> => {
    try {
      // A full batch means more may be waiting; a short one means the outbox is drained for now. The sweep
      // is checked between batches too, so a sustained backlog cannot postpone it forever.
      let full = true;
      while (!stopped && full) {
        full = (await dispatcher.dispatchBatch(batchSize, deliver, dispatchOptions)) === batchSize;
        await sweepIfDue();
      }
    } catch (error) {
      logger.error({ err: error }, 'outbox dispatch failed');
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = tick().finally(() => {
        inFlight = undefined;
        schedule();
      });
    }, pollIntervalMs);
  };

  return {
    start: schedule,
    stop: async () => {
      stopped = true;
      clearTimeout(timer);
      await inFlight;
    },
  };
}
