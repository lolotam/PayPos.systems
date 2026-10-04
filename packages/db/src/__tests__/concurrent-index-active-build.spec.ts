import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';

const files = vi.hoisted(() => ({ sql: [] as string[], timestamp: 9_999_999_999_999, hash: '' }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [{ sql: files.sql, folderMillis: files.timestamp, hash: files.hash }],
}));

let testDb: TestDatabase;
let owner: postgres.Sql;
let blocker: postgres.Sql;
let builder: postgres.Sql;
let observer: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  const options = { max: 1, onnotice: () => undefined };
  owner = postgres(testDb.ownerUrl, options);
  blocker = postgres(testDb.ownerUrl, options);
  builder = postgres(testDb.ownerUrl, options);
  observer = postgres(testDb.ownerUrl, options);
  await owner`SET statement_timeout = '15s'`;
  await builder`SET statement_timeout = '15s'`;
});
beforeEach(() => {
  files.timestamp++;
  files.hash = `recovery-build-${files.timestamp}`;
});
afterAll(async () => {
  await Promise.all([owner.end(), blocker.end(), builder.end(), observer.end()]);
  await testDb.drop();
});

async function activeIndex(name: string) {
  const [row] = await observer<{ oid: number; valid: boolean }[]>`
    SELECT c.oid, i.indisvalid AS valid FROM pg_stat_progress_create_index p
    JOIN pg_class c ON c.oid = p.index_relid JOIN pg_index i ON i.indexrelid = c.oid
    WHERE p.datid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND c.relname = ${name}`;
  return row;
}

async function waitForActiveIndex(name: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const index = await activeIndex(name);
    if (index?.valid === false) return index;
    await delay(50);
  }
  throw new Error('Concurrent build did not enter its invalid in-progress phase');
}

async function indexState(name: string) {
  const [row] = await observer<{ oid: number; valid: boolean }[]>`
    SELECT c.oid, i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${name}`;
  return row;
}

async function journalCount() {
  const rows =
    await observer`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${files.hash}`;
  return rows.length;
}

async function startBuild(table: string, key: string) {
  const indexName = `${table}_idx`;
  files.sql = [`CREATE INDEX CONCURRENTLY ${indexName} ON ${table} (id)`];
  await owner.unsafe(`CREATE TABLE ${table} (id int, value int)`);
  await owner.unsafe(`INSERT INTO ${table} VALUES (1, 2)`);
  await blocker`BEGIN`;
  await blocker.unsafe(`UPDATE ${table} SET value = 3`);
  // الكتابة المفتوحة تجعل البناء ينتظر بعد تسجيل index غير صالح، بدون الاعتماد على حجم البيانات.
  const build = builder.unsafe(`CREATE INDEX CONCURRENTLY ${indexName} ON ${table} (${key})`).then(
    () => undefined,
    (error: unknown) => error,
  );
  return { build, indexName };
}

it('times out without dropping a live build, then journals the completed build on retry', async () => {
  const { build, indexName } = await startBuild('recovery_active', 'id');
  const timeout = await owner`SHOW lock_timeout`;
  let before: { oid: number; valid: boolean } | undefined;
  try {
    before = await waitForActiveIndex(indexName);
    await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
      'Concurrent index "public"."recovery_active_idx" has an active build or lock; retry later',
    );
    expect(await indexState(indexName)).toEqual(before);
    expect(await journalCount()).toBe(0);
    expect(await owner`SHOW lock_timeout`).toEqual(timeout);
  } finally {
    await blocker`ROLLBACK`;
    expect(await build).toBeUndefined();
  }
  await applyMigrations(owner, 'unused');
  expect(await indexState(indexName)).toEqual({ oid: before?.oid, valid: true });
  expect(await journalCount()).toBe(1);
});

it.each([
  { label: 'matching', key: 'id', matches: true },
  { label: 'different', key: 'value', matches: false },
])(
  'never drops a $label index that completes after the initial invalid catalog read',
  async ({ label, key, matches }) => {
    const table = `recovery_finished_${label}`;
    const { build, indexName } = await startBuild(table, key);
    try {
      const before = await waitForActiveIndex(indexName);
      let intercepted = false;
      // نكمل البناء بعد قراءة INVALID الفعلية، ثم نسمح للـ runner باستعمال القراءة القديمة.
      const client = new Proxy(owner, {
        apply(target, thisArg, args: unknown[]) {
          const query: unknown = Reflect.apply(target, thisArg, args);
          const sql = (args[0] as readonly string[]).join('');
          if (intercepted || !sql.includes('i.indisvalid AS valid')) return query;
          intercepted = true;
          return Promise.resolve(query).then(async (rows) => {
            expect(rows).toMatchObject([before]);
            await blocker`ROLLBACK`;
            expect(await build).toBeUndefined();
            expect(await indexState(indexName)).toEqual({ oid: before.oid, valid: true });
            return rows;
          });
        },
      });
      const result = await applyMigrations(client, 'unused').then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(intercepted).toBe(true);
      if (matches) {
        expect(result).toBeUndefined();
        expect(await journalCount()).toBe(1);
      } else {
        expect(result).toHaveProperty(
          'message',
          expect.stringContaining('already exists with a different definition'),
        );
        expect(await journalCount()).toBe(0);
      }
      expect(await indexState(indexName)).toEqual({ oid: before.oid, valid: true });
    } finally {
      await blocker`ROLLBACK`;
      await build;
    }
  },
);
