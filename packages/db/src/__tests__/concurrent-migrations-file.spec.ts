import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const files = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [{ sql: files.sql, folderMillis: 9_999_999_999_997, hash: 'file-guard' }],
}));
let testDb: TestDatabase;
let owner: postgres.Sql;
let dir: string;
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  dir = mkdtempSync(join(tmpdir(), 'pospay-file-guard-'));
});
afterAll(async () => {
  await owner.end();
  await testDb.drop();
  rmSync(dir, { recursive: true, force: true });
});

// file() and reserve() build a deferred query or take a pooled connection, so the loss check must cover them.
it('aborts a file() query awaited after the session died and a reserve() taken after it', async () => {
  await owner`CREATE TABLE file_guard_test (id int)`;
  const sqlFile = join(dir, 'insert.sql');
  writeFileSync(sqlFile, 'INSERT INTO file_guard_test VALUES (9)');
  files.sql = ['-- pospay:data-step hold\nSELECT 1'];
  const killer = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(
      applyMigrations(owner, 'unused', {
        hold: async (client) => {
          const pending = client.file(sqlFile);
          const [{ pid }] = await client<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
          await killer`SELECT pg_terminate_backend(${pid}, 5000)`;
          expect(() => client.reserve()).toThrow('Migration session lost');
          await pending;
        },
      }),
    ).rejects.toThrow('Migration session lost its advisory lock; aborting');
    expect(await owner`SELECT id FROM file_guard_test`).toHaveLength(0);
  } finally {
    await killer.end();
  }
});
