import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { expectPgError, RATING_TENANT, seedRatingTenants } from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const TABLE = 'rating_settings';
const USER_ID = '01920000-0000-7000-8000-00000000aa01';
const NOW = '2026-10-30T00:00:00Z';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER_ID},'Synthetic operator','operator@example.test')`;
  await db.withTenant(A.company, (tx) =>
    tx.execute(sql`INSERT INTO rating_settings(company_id,id,business_id,requests_enabled,updated_by,updated_at,revision)
      VALUES(${A.company},${ids.newId()},${A.business},true,${USER_ID},${NOW},1)`),
  );
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQL) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: SQL) => db.withTenant(B.company, (tx) => tx.execute(query));

it('the table forces RLS and exposes exactly its required policies', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${TABLE}`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    [TABLE, true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename,cmd FROM pg_policies WHERE tablename=${TABLE} ORDER BY cmd`;
  expect(policies).toEqual([
    { tablename: TABLE, cmd: 'INSERT' },
    { tablename: TABLE, cmd: 'SELECT' },
    { tablename: TABLE, cmd: 'UPDATE' },
  ]);
});

it('tenant B reads zero rows of tenant A', async () => {
  expect(await asB(sql`SELECT id FROM rating_settings`)).toEqual([]);
  expect(await asA(sql`SELECT id FROM rating_settings`)).toHaveLength(1);
});

it('tenant B cannot write a row carrying tenant A company_id', async () => {
  await expectPgError(
    asB(sql`INSERT INTO rating_settings(company_id,id,business_id,requests_enabled,updated_by,updated_at,revision)
      VALUES(${A.company},${ids.newId()},${A.business},true,${USER_ID},${NOW},1)`),
    '42501',
  );
});

it('a cross-tenant update touches no row and the row cannot be re-homed', async () => {
  expect(await asB(sql`UPDATE rating_settings SET requests_enabled=false RETURNING id`)).toEqual(
    [],
  );
  await expectPgError(
    asA(sql`UPDATE rating_settings SET company_id=${B.company} RETURNING id`),
    '42501',
  );
});

it('tenant B writes its own row and tenant A never sees it', async () => {
  const inserted =
    await asB(sql`INSERT INTO rating_settings(company_id,id,business_id,requests_enabled,updated_by,updated_at,revision)
    VALUES(${B.company},${ids.newId()},${B.business},true,${USER_ID},${NOW},1) RETURNING id`);
  expect(inserted).toHaveLength(1);
  expect(await asA(sql`SELECT id FROM rating_settings`)).toHaveLength(1);
  await owner`DELETE FROM rating_settings WHERE company_id=${B.company}`;
});

it('the app cannot delete or truncate the table', async () => {
  await expectPgError(asA(sql`DELETE FROM rating_settings`), '42501');
  await expectPgError(asA(sql`TRUNCATE rating_settings`), '42501');
});

it('the dispatcher and auth roles have no privilege on the table', async () => {
  const rows = await owner<{ role: string; table: string }[]>`
    SELECT role,table_name AS table FROM unnest(ARRAY['pospay_dispatcher','pospay_auth']) AS role
    CROSS JOIN unnest(ARRAY[${TABLE}]::text[]) AS table_name
    WHERE has_table_privilege(role,table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`;
  expect(rows).toEqual([]);
});
