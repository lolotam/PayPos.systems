import { Writable } from 'node:stream';

import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import { createDispatchLoop } from '../dispatch-loop.ts';
import { MAX_ATTEMPTS } from '../retry-policy.ts';

const EXHAUSTED = {
  companyId: '01990000-0000-7000-8000-0000000000a0',
  id: '01990000-0000-7000-8000-000000000009',
  aggregateType: 'business',
  aggregateId: '01990000-0000-7000-8000-0000000000a1',
  eventType: 'BusinessCreated',
  payload: {},
  attempt: MAX_ATTEMPTS,
};

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

describe('a sustained backlog', () => {
  it('still sweeps expired idempotency keys between full batches', async () => {
    let clock = 0;
    let sweeps = 0;
    const loop = createDispatchLoop({
      dispatcher: {
        // Real batches do I/O; the yield keeps this fake from starving the timers the test waits on.
        dispatchBatch: async () => {
          await new Promise((done) => setImmediate(done));
          clock += 60_000;
          return 50;
        },
        sweepExpiredIdempotencyKeys: async () => {
          sweeps += 1;
          return 0;
        },
      },
      deliver,
      logger,
      batchSize: 50,
      sweepIntervalMs: 10 * 60 * 1000,
      now: () => clock,
    });
    loop.start();
    await until(() => sweeps >= 2);
    await loop.stop();
    expect(sweeps).toBeGreaterThanOrEqual(2);
  });
});

describe('events whose every claim crashed', () => {
  it('are logged at error level when the claim parks them', async () => {
    let logs = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    });
    const loop = createDispatchLoop({
      dispatcher: {
        dispatchBatch: async (_limit, _deliver, options) => {
          expect(options?.maxAttempts).toBe(MAX_ATTEMPTS);
          options?.onExhausted?.([{ ...EXHAUSTED }]);
          return 0;
        },
        sweepExpiredIdempotencyKeys: async () => 0,
      },
      deliver,
      logger: createLogger('info', { destination: sink, events: WORKER_LOG_EVENTS }),
      pollIntervalMs: 1,
    });
    loop.start();
    await until(() => logs.includes('outbox event parked'));
    await loop.stop();
    const [firstLine = ''] = logs.split(/\r?\n/);
    expect(JSON.parse(firstLine)).toMatchObject({
      level: 50,
      msg: 'outbox event parked',
      attempt: MAX_ATTEMPTS,
    });
  });
});

describe('a large expiry backlog', () => {
  it('sweeps batch after batch until one comes back short', async () => {
    const batches = [1_000, 1_000, 1_000, 12];
    let calls = 0;
    let clock = 0;
    const loop = createDispatchLoop({
      dispatcher: {
        // One step past the interval, then the clock stands still: exactly one sweep cycle is due.
        dispatchBatch: async () => {
          clock = 20 * 60 * 1000;
          return 0;
        },
        sweepExpiredIdempotencyKeys: async () => batches[calls++] ?? 0,
      },
      deliver,
      logger,
      pollIntervalMs: 1,
      now: () => clock,
    });
    loop.start();
    await until(() => calls >= 4);
    await wait(30);
    await loop.stop();
    expect(calls).toBe(4);
  });
});
