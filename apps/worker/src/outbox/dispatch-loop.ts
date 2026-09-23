import type { ClaimedEvent, DeliveryOutcome, OutboxDispatcherDatabase } from '@pospay/db';
import type { Logger } from '@pospay/observability';

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

  const tick = async (): Promise<void> => {
    try {
      // A full batch means more may be waiting; a short one means the outbox is drained for now.
      while (!stopped && (await dispatcher.dispatchBatch(batchSize, deliver)) === batchSize);
      if (!stopped && now() - lastSweep >= sweepIntervalMs) {
        lastSweep = now();
        const swept = await dispatcher.sweepExpiredIdempotencyKeys(1_000);
        logger.info({ swept }, 'idempotency keys swept');
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
