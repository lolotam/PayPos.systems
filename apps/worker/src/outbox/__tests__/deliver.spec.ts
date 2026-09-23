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

const KNOWN = { knownEventTypes: ['BusinessCreated', 'BranchCreated'] };

const harness = (firstTime = true) => {
  const tenants: string[] = [];
  const limits: (number | undefined)[] = [];
  // markEventConsumed's INSERT … RETURNING: one row the first time, none on a redelivery.
  const tx = { execute: async () => (firstTime ? [{ first: 1 }] : []) } as unknown as Tx;
  const app: Pick<Database, 'withTenant'> = {
    withTenant: async (companyId, fn, options) => {
      tenants.push(companyId);
      limits.push(options?.timeoutMs);
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
  return { app, tenants, limits, logger, logs: () => logs };
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
    expect(await createDeliverer(app, [match, other], logger, KNOWN)(EVENT)).toEqual({
      delivered: true,
    });
    expect([match.calls, other.calls]).toEqual([1, 0]);
    expect(tenants).toEqual([EVENT.companyId]);
  });

  it('skips a consumer that already applied the event', async () => {
    const { app, logger } = harness(false);
    const match = consumer('a.one', ['BusinessCreated']);
    expect(await createDeliverer(app, [match], logger, KNOWN)(EVENT)).toEqual({ delivered: true });
    expect(match.calls).toBe(0);
  });

  it('turns a failure into a retry with backoff, logging type only — never the payload', async () => {
    const { app, logger, logs } = harness();
    const failing = consumer('a.one', ['BusinessCreated'], async () => {
      throw new TypeError('bad tok_message_leak');
    });
    const outcome = await createDeliverer(app, [failing], logger, KNOWN)(EVENT);
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
    expect(await createDeliverer(app, [failing], logger, KNOWN)(last)).toEqual({
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

describe('consumer registration', () => {
  it('refuses two consumers with one id — the second would never apply its effect', () => {
    const { app, logger } = harness();
    const twins = [consumer('a.one', ['BusinessCreated']), consumer('a.one', ['BranchCreated'])];
    expect(() => createDeliverer(app, twins, logger, KNOWN)).toThrow(/share the id a.one/);
  });

  it.each(['orders_handler', 'a', 'Orders.handler'])(
    'refuses the id %s, which consumed_events would reject',
    (id) => {
      const { app, logger } = harness();
      expect(() =>
        createDeliverer(app, [consumer(id, ['BusinessCreated'])], logger, KNOWN),
      ).toThrow(/not a valid consumer id/);
    },
  );
});

describe('an event type this worker does not know', () => {
  it('is never acknowledged — it fails with backoff so a newer worker can take it', async () => {
    const { app, tenants, logger } = harness();
    const outcome = await createDeliverer(app, [], logger, { knownEventTypes: [] })(EVENT);
    expect(outcome).toEqual({ delivered: false, error: 'TypeError', retryInMs: retryDelayMs(1) });
    expect(tenants).toEqual([]);
  });

  it('a known type with no consumer is delivered', async () => {
    const { app, logger } = harness();
    expect(await createDeliverer(app, [], logger, KNOWN)(EVENT)).toEqual({ delivered: true });
  });
});

describe('a delivery that hangs', () => {
  it('runs each consumer under a server-side limit and starts none once the time is up', async () => {
    const { app, limits, logger } = harness();
    const slow = consumer(
      'a.one',
      ['BusinessCreated'],
      () => new Promise<undefined>((done) => setTimeout(() => done(undefined), 60)),
    );
    const next = consumer('b.two', ['BusinessCreated']);
    const outcome = await createDeliverer(app, [slow, next], logger, { ...KNOWN, timeoutMs: 40 })(
      EVENT,
    );
    expect(outcome).toMatchObject({ delivered: false, error: 'TimeoutError' });
    expect(limits).toHaveLength(1);
    expect(limits[0]).toBeGreaterThan(0);
    expect(limits[0]).toBeLessThanOrEqual(40);
    expect(next.calls).toBe(0);
  });

  it('counts as a failed attempt after the timeout instead of holding the batch', async () => {
    const { app, logger } = harness();
    const hanging = consumer(
      'a.one',
      ['BusinessCreated'],
      () => new Promise<undefined>(() => undefined),
    );
    expect(
      await createDeliverer(app, [hanging], logger, { ...KNOWN, timeoutMs: 20 })(EVENT),
    ).toEqual({
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
