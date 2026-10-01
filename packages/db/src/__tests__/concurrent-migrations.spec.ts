import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

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
