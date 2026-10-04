import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    {
      sql: ['CREATE INDEX CONCURRENTLY recovery_active_idx ON recovery_active (id)'],
      folderMillis: 9_999_999_999_999,
      hash: 'recovery-active-build',
    },
  ],
}));

let testDb: TestDatabase;
let owner: postgres.Sql;
let blocker: postgres.Sql;
let builder: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  const options = { max: 1, onnotice: () => undefined };
  owner = postgres(testDb.ownerUrl, options);
  blocker = postgres(testDb.ownerUrl, options);
  builder = postgres(testDb.ownerUrl, options);
});
afterAll(async () => {
  await Promise.all([owner.end(), blocker.end(), builder.end()]);
  await testDb.drop();
});

async function activeIndex() {
  const [row] = await owner<{ oid: number; valid: boolean }[]>`
    SELECT c.oid, i.indisvalid AS valid FROM pg_stat_progress_create_index p
    JOIN pg_class c ON c.oid = p.index_relid JOIN pg_index i ON i.indexrelid = c.oid
    WHERE p.datid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND c.relname = 'recovery_active_idx'`;
  return row;
}

async function waitForActiveIndex() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const index = await activeIndex();
    if (index?.valid === false) return index;
    await delay(50);
  }
  throw new Error('Concurrent build did not enter its invalid in-progress phase');
}

it('refuses recovery during a live concurrent build, then journals the completed build on retry', async () => {
  await owner`CREATE TABLE recovery_active (id int)`;
  await owner`INSERT INTO recovery_active VALUES (1)`;
  await owner`SET statement_timeout = '3s'`;
  await builder`SET statement_timeout = '10s'`;
  await blocker`BEGIN`;
  await blocker`UPDATE recovery_active SET id = 2`;
  // الكتابة المفتوحة تجعل البناء ينتظر بعد تسجيل index غير صالح، بدون الاعتماد على حجم البيانات.
  const build = builder`CREATE INDEX CONCURRENTLY recovery_active_idx ON recovery_active (id)`.then(
    () => undefined,
    (error: unknown) => error,
  );
  let before: { oid: number; valid: boolean } | undefined;
  try {
    before = await waitForActiveIndex();
    await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
      'Concurrent index "public"."recovery_active_idx" has an active build or lock; retry later',
    );
    expect(await activeIndex()).toEqual(before);
    expect(
      await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'recovery-active-build'`,
    ).toHaveLength(0);
  } finally {
    await blocker`ROLLBACK`;
    expect(await build).toBeUndefined();
  }
  await applyMigrations(owner, 'unused');
  const [completed] = await owner<{ oid: number; valid: boolean }[]>`
    SELECT c.oid, i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'recovery_active_idx'`;
  expect(completed).toEqual({ oid: before?.oid, valid: true });
  expect(
    await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'recovery-active-build'`,
  ).toHaveLength(1);
});
