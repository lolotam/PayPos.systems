import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { createDispatchLoop } from '../dispatch-loop.ts';

const logger = createLogger('silent');
const deliver = async () => ({ delivered: true }) as const;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
// Timer resolution differs between platforms (about 15 ms on Windows), so tests wait for a condition.
const until = async (condition: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !condition(); tries += 1) await wait(5);
};

describe('createDispatchLoop', () => {
  it('drains while batches come back full, then waits for the next poll', async () => {
    const results = [2, 2, 1];
    let calls = 0;
    const loop = createDispatchLoop({
      dispatcher: {
        dispatchBatch: async () => results[calls++] ?? 0,
        sweepExpiredIdempotencyKeys: async () => 0,
      },
      deliver,
      logger,
      pollIntervalMs: 5,
      batchSize: 2,
    });
    loop.start();
    await until(() => calls >= 3);
    await loop.stop();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(results.slice(0, 3)).toEqual([2, 2, 1]);
  });
});

describe('stopping', () => {
  it('stop() waits for the batch in flight and schedules nothing after it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let started = 0;
    let finished = 0;
    const loop = createDispatchLoop({
      dispatcher: {
        dispatchBatch: async () => {
          started += 1;
          await gate;
          finished += 1;
          return 0;
        },
        sweepExpiredIdempotencyKeys: async () => 0,
      },
      deliver,
      logger,
      pollIntervalMs: 1,
    });
    loop.start();
    await until(() => started === 1);
    const stopping = loop.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await wait(10);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect([started, finished]).toEqual([1, 1]);
    await wait(10);
    expect(started).toBe(1);
  });
});

describe('sweeping and failures', () => {
  it('sweeps expired idempotency keys once the interval has passed, and survives a failing batch', async () => {
    let clock = 0;
    let sweeps = 0;
    let batches = 0;
    const loop = createDispatchLoop({
      dispatcher: {
        dispatchBatch: async () => {
          batches += 1;
          clock += 1_000;
          if (batches === 1) throw new Error('database blip');
          return 0;
        },
        sweepExpiredIdempotencyKeys: async () => {
          sweeps += 1;
          return 3;
        },
      },
      deliver,
      logger,
      pollIntervalMs: 1,
      sweepIntervalMs: 2_500,
      now: () => clock,
    });
    loop.start();
    await until(() => batches > 3 && sweeps > 0);
    await loop.stop();
    expect(batches).toBeGreaterThan(3);
    expect(sweeps).toBeGreaterThanOrEqual(1);
  });
});
