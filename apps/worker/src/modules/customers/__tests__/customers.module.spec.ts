import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { Redis } from 'ioredis';
import { afterEach, expect, it, vi } from 'vitest';

import type { TenantWrappers, Tx } from '@pospay/db';

import { createRatingClaimsRuntime } from '../customers.module.ts';
import type { DaySessionsPort } from '../ports/day-sessions.port.ts';

const redisUrl =
  process.env['REDIS_URL'] ||
  `redis://:${process.env['REDIS_PASSWORD'] || 'pospay_dev_redis'}@127.0.0.1:6379`;

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

it('close quits the state client after the processor is drained', async () => {
  const quit = vi.spyOn(Redis.prototype, 'quit');
  const live = runtime();
  await live.ready();
  await live.close();
  const stateClients = quit.mock.instances.filter(
    (instance) => (instance as Redis).options.connectionName === 'pospay-rating-claims-state',
  );
  expect(stateClients).toHaveLength(1);
  // ioredis بيحوّل الحالة لـ end مع حدث الإغلاق، بعد رد QUIT بلحظة.
  await vi.waitFor(() => expect((stateClients[0] as Redis).status).toBe('end'));
});

it('close before connect does not throw', async () => {
  const live = runtime();
  await expect(live.close()).resolves.toBeUndefined();
});
