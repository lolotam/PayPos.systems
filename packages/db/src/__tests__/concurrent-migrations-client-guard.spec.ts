import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const files = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    { sql: files.sql, folderMillis: 9_999_999_999_997, hash: 'file-guard' },
  ],
}));
let testDb: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
beforeEach(async () => {
  await owner`DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'file-guard'`;
});
afterAll(async () => {
  // A test kills the backend owner holds, so a graceful end would wait for a dead socket.
  await owner.end({ timeout: 1 });
  await testDb.drop();
});

// A data step gets tagged templates, unsafe and begin; every other client method can reach a reconnected
// backend without the lock, so it is refused (including ones postgres.js adds later).
it('refuses the client methods a data step does not need', async () => {
  files.sql = ['-- pospay:data-step hold\nSELECT 1'];
  await applyMigrations(owner, 'unused', {
    hold: async (client) => {
      for (const name of ['file', 'reserve', 'notify', 'listen', 'largeObject', 'end'] as const)
        expect(() => (client[name] as () => unknown)()).toThrow(
          `client.${name}() is not available`,
        );
      expect(await client`SELECT 1 AS one`).toEqual([{ one: 1 }]);
    },
  });
});

it('aborts a query consumed with forEach after the session died', async () => {
  await owner`CREATE TABLE for_each_guard_test (id int)`;
  files.sql = ['-- pospay:data-step hold\nSELECT 1'];
  const killer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(
      applyMigrations(owner, 'unused', {
        hold: async (client) => {
          const pending = client`INSERT INTO for_each_guard_test VALUES (9)`;
          const [{ pid }] = await client<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
          await killer`SELECT pg_terminate_backend(${pid}, 5000)`;
          await pending.forEach(() => undefined);
        },
      }),
    ).rejects.toThrow('Migration session lost its advisory lock; aborting');
    expect(await owner`SELECT id FROM for_each_guard_test`).toHaveLength(0);
  } finally {
    await killer.end();
  }
});

// postgres.js queues a second statement behind the first on the only connection and dispatches it after a
// reconnect, so the guarded client accepts one statement at a time instead of checking at enqueue.
it('rejects a second statement or begin while one is in flight and still finishes the first', async () => {
  files.sql = ['-- pospay:data-step hold\nSELECT 1'];
  await applyMigrations(owner, 'unused', {
    hold: async (client) => {
      const first = client`SELECT pg_sleep(0.2), 1 AS one`;
      const settled = Promise.resolve(first);
      await expect(client`SELECT 2 AS two`).rejects.toThrow('one at a time');
      expect(() => client.begin(async () => undefined)).toThrow('one at a time');
      expect(await settled).toHaveLength(1);
      expect(await client`SELECT 3 AS three`).toEqual([{ three: 3 }]);
      expect(await client.begin(async (tx) => await tx`SELECT 4 AS four`)).toEqual([{ four: 4 }]);
    },
  });
});

it('never dispatches a statement started during an in-flight one after the backend is killed', async () => {
  await owner`CREATE TABLE queued_guard_test (id int)`;
  files.sql = ['-- pospay:data-step hold\nSELECT 1'];
  const killer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(
      applyMigrations(owner, 'unused', {
        hold: async (client) => {
          const [{ pid }] = await client<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
          const slow = Promise.resolve(client`SELECT pg_sleep(30)`).then(
            () => null,
            (error: unknown) => error,
          );
          const queued = Promise.resolve(client`INSERT INTO queued_guard_test VALUES (1)`).then(
            () => null,
            (error: unknown) => error,
          );
          await killer`SELECT pg_terminate_backend(${pid}, 5000)`;
          const [slowError, queuedError] = await Promise.all([slow, queued]);
          expect(slowError).toBeInstanceOf(Error);
          expect(String(queuedError)).toContain('one at a time');
        },
      }),
    ).rejects.toThrow('Migration session lost its advisory lock; aborting');
    // owner lost its backend, so the check goes through the separate connection.
    expect(await killer`SELECT id FROM queued_guard_test`).toHaveLength(0);
  } finally {
    await killer.end();
  }
});
