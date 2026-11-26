import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, expect, it, vi } from 'vitest';

import type { TenantWrappers, Tx } from '@pospay/db';

import { createRatingClaimsRuntime } from '../customers.module.ts';
import type { DaySessionsPort } from '../ports/day-sessions.port.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;
const STATE_CONNECTION_NAME = 'pospay-rating-claims-state';

afterEach(() => {
  vi.restoreAllMocks();
});

/** يبني مصنع حيّ بمنافذ وهمية، وبادئة خاصة بكل اختبار. */
function runtime() {
  return createRatingClaimsRuntime({
    database: { withTenant: vi.fn() } as unknown as Pick<TenantWrappers, 'withTenant'>,
    ids: systemUuidV7(),
    clock: { now: () => new Date() },
    daySessions: {} as unknown as DaySessionsPort<Tx>,
    deriver: null,
    redisUrl,
    statePrefix: `pospay-test-rating-claims-${systemUuidV7().newId()}`,
    logger: createLogger('error'),
  });
}

/** إفلات عميل Redis بيعشل بس لعميل الحالة، والباقي بيتقفل عادي. */
function failStateQuit(message: string): void {
  const original = Redis.prototype.quit;
  vi.spyOn(Redis.prototype, 'quit').mockImplementation(async function (this: Redis) {
    if (this.options.connectionName === STATE_CONNECTION_NAME) throw new Error(message);
    await original.call(this);
    return 'OK';
  });
}

/** عملاء Redis اللي عميل الحالة منهم. */
function stateClientsOf(spy: { mock: { instances: unknown[] } }): Redis[] {
  return spy.mock.instances.filter(
    (instance) => (instance as Redis).options.connectionName === STATE_CONNECTION_NAME,
  ) as Redis[];
}

it('close quits the state client after the processor is drained', async () => {
  const quit = vi.spyOn(Redis.prototype, 'quit');
  const live = runtime();
  await live.ready();
  await live.close();
  const stateClients = stateClientsOf(quit);
  expect(stateClients).toHaveLength(1);
  // ioredis بيحوّل الحالة لـ end مع حدث الإغلاق، بعد رد QUIT بلحظة.
  await vi.waitFor(() => expect(stateClients[0]?.status).toBe('end'));
});

it('close before connect does not throw', async () => {
  const live = runtime();
  await expect(live.close()).resolves.toBeUndefined();
});

it('a processor close failure still closes the state client and rethrows', async () => {
  const quit = vi.spyOn(Redis.prototype, 'quit');
  vi.spyOn(Worker.prototype, 'close').mockRejectedValue(
    new Error('SYNTHETIC_WORKER_CLOSE_FAILURE'),
  );
  const live = runtime();
  await live.ready();
  await expect(live.close()).rejects.toThrow('SYNTHETIC_WORKER_CLOSE_FAILURE');
  // عميل الحالة اتقفل رغم إن العامل فشل.
  expect(stateClientsOf(quit)).toHaveLength(1);
});

it('a state client close failure still drains the processor and rethrows', async () => {
  const workerClose = vi.spyOn(Worker.prototype, 'close');
  failStateQuit('SYNTHETIC_STATE_CLOSE_FAILURE');
  const live = runtime();
  await live.ready();
  await expect(live.close()).rejects.toThrow('SYNTHETIC_STATE_CLOSE_FAILURE');
  // العامل اتصفّى قبل ما عميل الحالة يفشل.
  expect(workerClose).toHaveBeenCalled();
});

it('both close failures arrive together as one aggregate error', async () => {
  vi.spyOn(Worker.prototype, 'close').mockRejectedValue(
    new Error('SYNTHETIC_WORKER_CLOSE_FAILURE'),
  );
  failStateQuit('SYNTHETIC_STATE_CLOSE_FAILURE');
  const live = runtime();
  await live.ready();
  const failure = await live.close().then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AggregateError);
  const errors = (failure as AggregateError).errors;
  expect(errors.map((error) => (error as Error).message)).toEqual([
    'SYNTHETIC_WORKER_CLOSE_FAILURE',
    'SYNTHETIC_STATE_CLOSE_FAILURE',
  ]);
});
