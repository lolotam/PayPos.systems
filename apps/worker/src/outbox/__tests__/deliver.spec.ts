import { Writable } from 'node:stream';

import type { ClaimedEvent, Database, Tx } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { WORKER_LOG_EVENTS } from '../../shared/log-events.ts';
import type { OutboxConsumer } from '../consumer.ts';
import { createDeliverer } from '../deliver.ts';
import { MAX_ATTEMPTS, retryDelayMs } from '../retry-policy.ts';

// The dedupe row and the consumer's own effect are proven against Postgres in packages/db; here the
// routing, the tenant, and how a consumer failure turns into a retry or a park.
const EVENT: ClaimedEvent = {
  companyId: '01990000-0000-7000-8000-0000000000a0',
  id: '01990000-0000-7000-8000-000000000001',
  aggregateType: 'business',
  aggregateId: '01990000-0000-7000-8000-0000000000a1',
  eventType: 'BusinessCreated',
  payload: { secret_token: 'tok_payload_leak' },
  attempt: 1,
};

const harness = (firstTime = true) => {
  const tenants: string[] = [];
  // markEventConsumed's INSERT … RETURNING: one row the first time, none on a redelivery.
  const tx = { execute: async () => (firstTime ? [{ first: 1 }] : []) } as unknown as Tx;
  const app: Pick<Database, 'withTenant'> = {
    withTenant: async (companyId, fn) => {
      tenants.push(companyId);
      return fn(tx);
    },
  };
  let logs = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  const logger = createLogger('info', { destination: sink, events: WORKER_LOG_EVENTS });
  return { app, tenants, logger, logs: () => logs };
};

const consumer = (
  id: string,
  eventTypes: string[],
  handle = async () => undefined,
): OutboxConsumer & { calls: number } => {
  const record = {
    id,
    eventTypes,
    calls: 0,
    handle: async () => {
      record.calls += 1;
      await handle();
    },
  };
  return record;
};

describe('createDeliverer', () => {
  it('runs only the consumers of the event type, inside the event company', async () => {
    const { app, tenants, logger } = harness();
    const [match, other] = [
      consumer('a.one', ['BusinessCreated']),
      consumer('b.two', ['BranchCreated']),
    ];
    expect(await createDeliverer(app, [match, other], logger)(EVENT)).toEqual({ delivered: true });
    expect([match.calls, other.calls]).toEqual([1, 0]);
    expect(tenants).toEqual([EVENT.companyId]);
  });

  it('skips a consumer that already applied the event', async () => {
    const { app, logger } = harness(false);
    const match = consumer('a.one', ['BusinessCreated']);
    expect(await createDeliverer(app, [match], logger)(EVENT)).toEqual({ delivered: true });
    expect(match.calls).toBe(0);
  });

  it('turns a failure into a retry with backoff, logging type only — never the payload', async () => {
    const { app, logger, logs } = harness();
    const failing = consumer('a.one', ['BusinessCreated'], async () => {
      throw new TypeError('bad tok_message_leak');
    });
    const outcome = await createDeliverer(app, [failing], logger)(EVENT);
    expect(outcome).toEqual({ delivered: false, error: 'TypeError', retryInMs: retryDelayMs(1) });
    expect(logs()).toContain('outbox delivery failed');
    expect(logs()).not.toContain('tok_payload_leak');
    expect(logs()).not.toContain('tok_message_leak');
  });

  it('parks the event when the last attempt fails, and says so at error level', async () => {
    const { app, logger, logs } = harness();
    const failing = consumer('a.one', ['BusinessCreated'], async () => {
      throw new Error('still failing');
    });
    const last = { ...EVENT, attempt: MAX_ATTEMPTS };
    expect(await createDeliverer(app, [failing], logger)(last)).toEqual({
      delivered: false,
      error: 'Error',
      retryInMs: null,
    });
    expect(JSON.parse(logs())).toMatchObject({
      level: 50,
      msg: 'outbox event parked',
      attempt: 10,
    });
  });
});

describe('a delivery that hangs', () => {
  it('counts as a failed attempt after the timeout instead of holding the batch', async () => {
    const { app, logger } = harness();
    const hanging = consumer(
      'a.one',
      ['BusinessCreated'],
      () => new Promise<undefined>(() => undefined),
    );
    expect(await createDeliverer(app, [hanging], logger, 20)(EVENT)).toEqual({
      delivered: false,
      error: 'TimeoutError',
      retryInMs: retryDelayMs(1),
    });
  });
});

describe('retryDelayMs', () => {
  it('backs off exponentially from 5 s, capped at one hour, and parks after the 10th attempt', () => {
    expect([1, 2, 3, 9].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 1_280_000]);
    expect(retryDelayMs(10)).toBeNull();
    expect(() => retryDelayMs(0)).toThrow(RangeError);
  });
});
