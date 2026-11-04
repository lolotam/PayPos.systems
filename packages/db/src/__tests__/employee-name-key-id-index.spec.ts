import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { readPgTestEnv } from '../../test/pg-env.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { applyMigrations } from '../concurrent-migrations.ts';
import { migrationDataSteps } from '../data-steps/index.ts';

// PP-122: الهجرة الحقيقية بتتقري من الملف نفسه بالاسم من غير الرقم، عشان إعادة الترقيم ما تكسرش الاختبار.
const INDEX = 'employees_company_business_name_en_key_id_active_idx';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const migration = readdirSync(MIGRATIONS).filter((name) =>
  name.endsWith('_employee-name-key-id-index.sql'),
);
const statements = readFileSync(new URL(migration[0] ?? 'missing', MIGRATIONS), 'utf8').split(
  '--> statement-breakpoint',
);

const files = vi.hoisted(() => ({ sql: [] as string[], timestamp: 9_999_999_999_999, hash: '' }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [{ sql: files.sql, folderMillis: files.timestamp, hash: files.hash }],
}));

let testDb: TestDatabase;
let owner: postgres.Sql;
const migrate = () =>
  applyMigrations(
    owner,
    'unused',
    migrationDataSteps(testDb.ownerUrl, readPgTestEnv().appPassword),
  );
beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedTwoTenants(testDb.ownerUrl);
});
beforeEach(() => {
  files.timestamp++;
  files.hash = `employee-name-key-id-${files.timestamp}`;
  files.sql = statements;
});
afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

async function indexState(name: string) {
  const [row] = await owner<{ oid: number; valid: boolean; definition: string }[]>`
    SELECT c.oid, i.indisvalid AS valid, pg_get_indexdef(c.oid) AS definition
    FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = ${name} AND n.nspname = 'public'`;
  return row;
}

async function journalCount() {
  const rows = await owner`SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${files.hash}`;
  return rows.length;
}

it('the migrated schema has one valid partial index with the id as its last key column', async () => {
  expect(migration).toHaveLength(1);
  expect(await indexState(INDEX)).toMatchObject({
    valid: true,
    definition: `CREATE INDEX ${INDEX} ON public.employees USING btree (company_id, business_id, name_en_key, id) WHERE (deleted_at IS NULL)`,
  });
  for (const kept of [
    'employees_company_business_name_en_key_idx',
    'employees_company_business_name_ar_key_idx',
    'employees_company_business_id_idx',
  ])
    expect((await indexState(kept))?.valid).toBe(true);
});

it('rerunning the migration over its valid index keeps the same index and journals once', async () => {
  const before = await indexState(INDEX);
  await migrate();
  expect(await indexState(INDEX)).toEqual(before);
  expect(await journalCount()).toBe(1);
});

let employeeNumber = 9_000;
async function insertEmployee(name: string, key: string) {
  const { company, business, branch } = TENANT.A;
  const id = systemUuidV7().newId();
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${id},${business},${branch},${name},${key},'staff','2026-01-01',${++employeeNumber})`;
  return id;
}

async function storedKey(id: string) {
  const [row] = await owner<{ key: string; xmin: string }[]>`
    SELECT name_en_key AS key, xmin::text AS xmin FROM employees WHERE company_id = ${TENANT.A.company} AND id = ${id}`;
  return row;
}

// على Postgres 16 مفتاح عشوائي طوله 2645–2660 بايت بيدخل الفهرس القديم وبيتعدّى حد الجديد بالـ id (16 بايت).
// خطوة employee-name-keys بتشتغل قبل البناء، فالمفتاح القديم اللي مش مشتق من الاسم بيتصلح الأول والبناء بيعدّي.
it('a legacy non-canonical key too long for the new index is re-derived first, so the build succeeds', async () => {
  await owner.unsafe(`DROP INDEX "${INDEX}"`);
  const id = await insertEmployee(
    'Stored long key',
    randomBytes(2_000).toString('base64url').slice(0, 2_652),
  );
  await migrate();
  expect((await storedKey(id))?.key).toBe(employeeNameMatchKey('Stored long key'));
  expect((await indexState(INDEX))?.valid).toBe(true);
  expect(await journalCount()).toBe(1);
});

it('rerunning the step over derived keys writes no row and keeps the index', async () => {
  const id = await insertEmployee('Already derived', employeeNameMatchKey('Already derived'));
  const [before, index] = [await storedKey(id), await indexState(INDEX)];
  await migrate();
  expect(await storedKey(id)).toEqual(before);
  expect(await indexState(INDEX)).toEqual(index);
  expect(await journalCount()).toBe(1);
});
