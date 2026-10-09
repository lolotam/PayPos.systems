import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const files = vi.hoisted(() => ({ sql: [] as string[], timestamp: 9_999_999_999_999 }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    { sql: files.sql, folderMillis: files.timestamp, hash: 'test-migration' },
  ],
}));
let testDb: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner.end();
  await testDb.drop();
});
beforeEach(async () => {
  await owner`DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`;
});

it('concurrent prefix survives failure, transactional suffix rolls back and a restart journals exactly once', async () => {
  await owner`CREATE TABLE notification_migration_test (id int)`;
  const prefix = [
    'DROP INDEX CONCURRENTLY IF EXISTS notification_migration_test_idx',
    'CREATE INDEX CONCURRENTLY notification_migration_test_idx ON notification_migration_test(id)',
  ];
  files.sql = [
    ...prefix,
    'ALTER TABLE notification_migration_test ADD COLUMN value int',
    'SELECT missing_test_function()',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow();
  expect(
    await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'notification_migration_test_idx'`,
  ).toHaveLength(1);
  expect(
    await owner`SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_migration_test' AND column_name = 'value'`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
  files.sql = [...prefix, 'ALTER TABLE notification_migration_test ADD COLUMN value int'];
  await applyMigrations(owner, 'unused');
  await applyMigrations(owner, 'unused');
  expect(
    await owner`SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_migration_test' AND column_name = 'value'`,
  ).toHaveLength(1);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});

it('runs de-duplicated data steps in marker order before the concurrent prefix and suffix', async () => {
  await owner`CREATE TABLE data_step_order_test (id int)`;
  const calls: string[] = [];
  const first = vi.fn(async (client: postgres.Sql) => {
    expect(await client`SELECT * FROM data_step_order_test`).toHaveLength(0);
    expect(
      await client`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_order_idx'`,
    ).toHaveLength(0);
    calls.push('first');
  });
  files.sql = [
    '-- pospay:data-step first\nCREATE INDEX CONCURRENTLY data_step_order_idx ON data_step_order_test(id)',
    '-- pospay:data-step second\n-- pospay:data-step first\nINSERT INTO data_step_order_test VALUES (1)',
  ];
  await applyMigrations(owner, 'unused', {
    first,
    second: async () => {
      calls.push('second');
    },
  });
  expect(first).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(['first', 'second']);
  expect(await owner`SELECT id FROM data_step_order_test`).toEqual([{ id: 1 }]);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});

it('rejects an unknown marker before any step, statement or journal row', async () => {
  files.sql = [
    '-- pospay:data-step known\nCREATE TABLE data_step_unknown_test (id int)',
    '-- pospay:data-step missing\nSELECT 1',
  ];
  const known = vi.fn(async () => undefined);
  await expect(applyMigrations(owner, 'unused', { known })).rejects.toThrow(
    'Unknown migration data step missing; migration aborted',
  );
  expect(known).not.toHaveBeenCalled();
  expect(await owner`SELECT to_regclass('data_step_unknown_test') AS relation`).toEqual([
    { relation: null },
  ]);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
});

it('leaves statements and the journal untouched when a data step throws', async () => {
  await owner`CREATE TABLE data_step_failure_test (id int)`;
  files.sql = [
    '-- pospay:data-step fails\nCREATE INDEX CONCURRENTLY data_step_failure_idx ON data_step_failure_test(id)',
    'INSERT INTO data_step_failure_test VALUES (1)',
  ];
  await expect(
    applyMigrations(owner, 'unused', {
      fails: async () => {
        throw new Error('Synthetic data step failure');
      },
    }),
  ).rejects.toThrow('Synthetic data step failure');
  expect(await owner`SELECT * FROM data_step_failure_test`).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM pg_indexes WHERE indexname = 'data_step_failure_idx'`,
  ).toHaveLength(0);
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(0);
});

it('never runs or resolves data steps for an already journaled migration', async () => {
  files.sql = ['-- pospay:data-step once\nSELECT 1'];
  const once = vi.fn(async () => undefined);
  await applyMigrations(owner, 'unused', { once });
  once.mockClear();
  await applyMigrations(owner, 'unused', { once });
  await applyMigrations(owner, 'unused');
  expect(once).not.toHaveBeenCalled();
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'test-migration'`,
  ).toHaveLength(1);
});
