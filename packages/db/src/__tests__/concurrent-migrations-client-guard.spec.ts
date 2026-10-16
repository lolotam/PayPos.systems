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
  await owner.end();
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
