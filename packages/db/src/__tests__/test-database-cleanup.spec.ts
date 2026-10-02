import { beforeEach, expect, it, vi } from 'vitest';
import type * as Vitest from 'vitest';
import { createTestDatabase } from '../../test/test-database.ts';

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  unsafe: vi.fn(),
  end: vi.fn(),
}));
vi.mock('postgres', () => ({
  default: () => Object.assign(fixture.query, { unsafe: fixture.unsafe, end: fixture.end }),
}));
vi.mock('vitest', async (original) => ({
  ...(await original<typeof Vitest>()),
  inject: () => ({
    host: '127.0.0.1',
    port: '5432',
    ownerUser: 'synthetic',
    ownerPassword: 'synthetic',
    appPassword: 'synthetic',
    authPassword: 'synthetic',
    dispatcherPassword: 'synthetic',
    notificationsPassword: 'synthetic',
    template: 'pospay_tpl_synthetic',
    runId: 'synthetic',
  }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  fixture.query.mockResolvedValue([]);
  fixture.unsafe.mockResolvedValue([]);
  fixture.end.mockResolvedValue(undefined);
});

it('a failed template clone releases its session lock and closes its maintenance pool', async () => {
  const failure = new Error('SYNTHETIC_CLONE_FAILURE');
  fixture.unsafe.mockRejectedValueOnce(failure);
  await expect(createTestDatabase()).rejects.toBe(failure);
  expect(fixture.query.mock.calls.at(-1)?.[0].join('')).toContain('pg_advisory_unlock');
  expect(fixture.end).toHaveBeenCalledOnce();
});

it('failure before acquiring the clone lock also closes the maintenance pool', async () => {
  fixture.query.mockRejectedValueOnce(new Error('SYNTHETIC_MAINTENANCE_FAILURE'));
  await expect(createTestDatabase()).rejects.toThrow('SYNTHETIC_MAINTENANCE_FAILURE');
  expect(fixture.end).toHaveBeenCalledOnce();
});

it('a failed clone drop still closes the pool it owns', async () => {
  const database = await createTestDatabase();
  fixture.unsafe.mockRejectedValueOnce(new Error('SYNTHETIC_DROP_FAILURE'));
  await expect(database.drop()).rejects.toThrow('SYNTHETIC_DROP_FAILURE');
  expect(fixture.end).toHaveBeenCalledOnce();
});
