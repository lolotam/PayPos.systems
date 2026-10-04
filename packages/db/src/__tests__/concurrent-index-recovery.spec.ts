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
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
beforeEach(() => {
  files.timestamp++;
  files.hash = `recovery-test-${files.timestamp}`;
});
afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

async function indexState(name: string) {
  const [row] = await owner<{ oid: number; valid: boolean }[]>`
    SELECT c.oid, i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = ${name} AND n.nspname = 'public'`;
  return row;
}

async function journalCount() {
  const rows = await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${files.hash}`;
  return rows.length;
}

it('normal first run builds a valid index and journals exactly once', async () => {
  await owner`CREATE TABLE recovery_first (id int)`;
  files.sql = [
    'CREATE INDEX CONCURRENTLY recovery_first_idx ON recovery_first (id)',
    'ALTER TABLE recovery_first ADD COLUMN value int',
  ];
  await applyMigrations(owner, 'unused');
  const index = await indexState('recovery_first_idx');
  expect(index?.valid).toBe(true);
  expect(await journalCount()).toBe(1);
  await applyMigrations(owner, 'unused');
  expect(await indexState('recovery_first_idx')).toEqual(index);
  expect(await journalCount()).toBe(1);
});

it('retries a completed unconditional build with no journal after the suffix rolled back', async () => {
  await owner`CREATE TABLE recovery_completed (id int, "to" timestamptz)`;
  const create =
    'CREATE UNIQUE INDEX CONCURRENTLY "recovery_completed_idx" ON "recovery_completed" USING btree ("id") WHERE "recovery_completed"."to" IS NULL';
  files.sql = [
    create,
    'ALTER TABLE recovery_completed ADD COLUMN value int',
    'SELECT missing_recovery_function()',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow();
  const index = await indexState('recovery_completed_idx');
  expect(index?.valid).toBe(true);
  expect(await journalCount()).toBe(0);
  files.sql = [create, 'ALTER TABLE recovery_completed ADD COLUMN value int'];
  await applyMigrations(owner, 'unused');
  expect(await indexState('recovery_completed_idx')).toEqual(index);
  expect(await journalCount()).toBe(1);
  expect(await owner`SELECT value FROM recovery_completed`).toEqual([]);
});

it('drops an invalid leftover from a failed concurrent unique build and rebuilds it', async () => {
  await owner`CREATE TABLE recovery_invalid (id int)`;
  await owner`INSERT INTO recovery_invalid VALUES (1), (1)`;
  files.sql = ['CREATE UNIQUE INDEX CONCURRENTLY recovery_invalid_idx ON recovery_invalid (id)'];
  await expect(applyMigrations(owner, 'unused')).rejects.toMatchObject({ code: '23505' });
  const invalid = await indexState('recovery_invalid_idx');
  expect(invalid?.valid).toBe(false);
  expect(await journalCount()).toBe(0);
  await owner`DELETE FROM recovery_invalid WHERE ctid IN (SELECT ctid FROM recovery_invalid LIMIT 1)`;
  await applyMigrations(owner, 'unused');
  const rebuilt = await indexState('recovery_invalid_idx');
  expect(rebuilt?.valid).toBe(true);
  expect(rebuilt?.oid).not.toBe(invalid?.oid);
  expect(await journalCount()).toBe(1);
  await expect(owner`INSERT INTO recovery_invalid VALUES (1)`).rejects.toMatchObject({
    code: '23505',
  });
});

it('rejects a valid same-name index with a different definition without changing it or journaling', async () => {
  await owner`CREATE TABLE recovery_conflict (id int, value int)`;
  await owner`CREATE INDEX recovery_conflict_idx ON recovery_conflict (value)`;
  const index = await indexState('recovery_conflict_idx');
  files.sql = [
    'CREATE INDEX CONCURRENTLY recovery_conflict_idx ON recovery_conflict (id)',
    'ALTER TABLE recovery_conflict ADD COLUMN suffix int',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
    'Concurrent index "public"."recovery_conflict_idx" already exists with a different definition; migration aborted',
  );
  expect(await indexState('recovery_conflict_idx')).toEqual(index);
  expect(await journalCount()).toBe(0);
  expect(
    await owner`SELECT 1 FROM information_schema.columns WHERE table_name = 'recovery_conflict' AND column_name = 'suffix'`,
  ).toHaveLength(0);
});

it('resolves quoted names in the target table schema, regardless of the search path', async () => {
  await owner`CREATE SCHEMA "Recovery.Schema"`;
  await owner`CREATE TABLE "Recovery.Schema"."Some.Table" (id int, "to" int)`;
  await owner`CREATE INDEX "Quoted ""Index" ON "Recovery.Schema"."Some.Table" (id) WHERE "Some.Table"."to" IS NULL`;
  await owner`CREATE TABLE recovery_decoy (value int)`;
  await owner`CREATE INDEX "Quoted ""Index" ON recovery_decoy (value)`;
  files.sql = [
    'CREATE INDEX CONCURRENTLY "Quoted ""Index" ON "Recovery.Schema"."Some.Table" USING btree (id) WHERE "Recovery.Schema"."Some.Table"."to" IS NULL',
  ];
  await applyMigrations(owner, 'unused');
  expect(await journalCount()).toBe(1);
});

it.each([
  ['sort', '(id DESC)', '(id ASC)'],
  ['nulls', '(id DESC NULLS LAST)', '(id DESC NULLS FIRST)'],
  ['predicate', '(id) WHERE value IS NULL', '(id) WHERE value IS NOT NULL'],
  ['include', '(id) INCLUDE (value)', '(id)'],
  ['expression', '((id + 1))', '((id + 2))'],
  ['opclass', '(label text_pattern_ops)', '(label)'],
  ['options', '(id) WITH (fillfactor=70)', '(id) WITH (fillfactor=80)'],
])(
  'refuses different %s definitions even when the indexed columns have the same names',
  async (kind, existing, expected) => {
    const table = `recovery_compare_${kind}`;
    const index = `${table}_idx`;
    await owner.unsafe(`CREATE TABLE ${table} (id int, value int, label text)`);
    await owner.unsafe(`CREATE INDEX ${index} ON ${table} ${existing}`);
    const before = await indexState(index);
    files.sql = [`CREATE INDEX CONCURRENTLY ${index} ON ${table} ${expected}`];
    await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
      'already exists with a different definition',
    );
    expect(await indexState(index)).toEqual(before);
    expect(await journalCount()).toBe(0);
  },
);

it('canonicalizes a matching complex definition without changing the index or leaving temporary objects', async () => {
  await owner`CREATE TABLE recovery_canonical (id int, value int, label text)`;
  await owner`CREATE UNIQUE INDEX recovery_canonical_idx ON recovery_canonical
    (label text_pattern_ops DESC NULLS LAST, (id + 1)) INCLUDE (value)
    NULLS NOT DISTINCT WITH (fillfactor=70) WHERE value IS NULL AND label IS NOT NULL`;
  const before = await indexState('recovery_canonical_idx');
  files.sql = [
    'CREATE UNIQUE INDEX CONCURRENTLY "recovery_canonical_idx" ON "public"."recovery_canonical" USING btree ("label" text_pattern_ops DESC NULLS LAST, ("id" + 1)) INCLUDE ("value") NULLS NOT DISTINCT WITH (fillfactor = 70) WHERE "recovery_canonical"."value" IS NULL AND "recovery_canonical"."label" IS NOT NULL',
  ];
  await applyMigrations(owner, 'unused');
  expect(await indexState('recovery_canonical_idx')).toEqual(before);
  expect(await journalCount()).toBe(1);
  expect(await owner`SELECT 1 FROM pg_class WHERE relnamespace = pg_my_temp_schema()`).toHaveLength(
    0,
  );
});

it('rejects a same-name index on another table and a same-name table', async () => {
  await owner`CREATE TABLE recovery_wrong_target (id int)`;
  await owner`CREATE TABLE recovery_other_target (id int)`;
  await owner`CREATE INDEX recovery_wrong_target_idx ON recovery_other_target (id)`;
  files.sql = ['CREATE INDEX CONCURRENTLY recovery_wrong_target_idx ON recovery_wrong_target (id)'];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
    'already exists with a different definition',
  );
  await owner`CREATE TABLE recovery_relation_collision (id int)`;
  files.sql = [
    'CREATE INDEX CONCURRENTLY recovery_relation_collision ON recovery_wrong_target (id)',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
    'already exists with a different definition',
  );
  expect(await journalCount()).toBe(0);
});

it('keeps concurrent-prefix validation and ordinary CREATE INDEX execution unchanged', async () => {
  await owner`CREATE TABLE recovery_ordinary (id int)`;
  files.sql = [
    'ALTER TABLE recovery_ordinary ADD COLUMN value int',
    'CREATE INDEX CONCURRENTLY recovery_ordinary_idx ON recovery_ordinary (id)',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
    'Concurrent indexes must precede transactional migration statements',
  );
  expect(await indexState('recovery_ordinary_idx')).toBeUndefined();
  await owner`CREATE INDEX recovery_ordinary_idx ON recovery_ordinary (id)`;
  files.sql = ['CREATE INDEX recovery_ordinary_idx ON recovery_ordinary (id)'];
  await expect(applyMigrations(owner, 'unused')).rejects.toMatchObject({ code: '42P07' });
  expect(await journalCount()).toBe(0);
});

it('never drops an invalid same-name index belonging to another table', async () => {
  await owner`CREATE TABLE recovery_invalid_target (id int)`;
  await owner`CREATE TABLE recovery_invalid_other (id int)`;
  await owner`INSERT INTO recovery_invalid_other VALUES (1), (1)`;
  await expect(
    owner`CREATE UNIQUE INDEX CONCURRENTLY recovery_invalid_other_idx ON recovery_invalid_other (id)`,
  ).rejects.toMatchObject({ code: '23505' });
  const before = await indexState('recovery_invalid_other_idx');
  expect(before?.valid).toBe(false);
  files.sql = [
    'CREATE UNIQUE INDEX CONCURRENTLY recovery_invalid_other_idx ON recovery_invalid_target (id)',
  ];
  await expect(applyMigrations(owner, 'unused')).rejects.toThrow('target table differs');
  expect(await indexState('recovery_invalid_other_idx')).toEqual(before);
  expect(await journalCount()).toBe(0);
});

it.each([false, true])(
  'rejects a multi-statement chunk before execution or probing (existing=%s)',
  async (existing) => {
    const table = existing ? 'recovery_chunk_existing' : 'recovery_chunk_first';
    const index = `${table}_idx`;
    await owner.unsafe(`CREATE TABLE ${table} (id int)`);
    if (existing) await owner.unsafe(`CREATE INDEX ${index} ON ${table} (id)`);
    const before = await indexState(index);
    files.sql = [
      `CREATE INDEX CONCURRENTLY ${index} ON ${table} (id); INSERT INTO public.${table} VALUES (1)`,
    ];
    const execute = vi.spyOn(owner, 'unsafe');
    try {
      await expect(applyMigrations(owner, 'unused')).rejects.toThrow(
        'Cannot safely resolve CREATE INDEX CONCURRENTLY statement',
      );
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
    expect(await indexState(index)).toEqual(before);
    expect(await owner.unsafe(`SELECT * FROM ${table}`)).toHaveLength(0);
    expect(await journalCount()).toBe(0);
  },
);

it('ignores tablespace in definition comparisons without resolving it', async () => {
  await owner`CREATE TABLE recovery_tablespace (id int)`;
  await owner`CREATE INDEX recovery_tablespace_idx ON recovery_tablespace (id)`;
  const before = await indexState('recovery_tablespace_idx');
  files.sql = [
    'CREATE INDEX CONCURRENTLY recovery_tablespace_idx ON recovery_tablespace (id) TABLESPACE unused_storage',
  ];
  await applyMigrations(owner, 'unused');
  expect(await indexState('recovery_tablespace_idx')).toEqual(before);
  expect(await journalCount()).toBe(1);
});
