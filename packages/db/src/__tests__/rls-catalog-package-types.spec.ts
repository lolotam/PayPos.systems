import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-0000000005e2';
const OTHER = '01920000-0000-7000-8000-0000000005e3';
const SECOND_BUSINESS = '01920000-0000-7000-8000-0000000005e4';
const FOREIGN_SERVICE = '01920000-0000-7000-8000-0000000005e5';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  for (const tenant of [A, B]) {
    await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
      VALUES (${tenant.company},${ID},${tenant.business},'Synthetic service','0.000','ZERO')`;
    await owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
      VALUES (${tenant.company},${ID},${tenant.business},'Sentinel','25.000',90)`;
    await owner`INSERT INTO package_type_components(company_id,id,business_id,package_type_id,service_id,sessions,position)
      VALUES (${tenant.company},${ID},${tenant.business},${ID},${ID},10,1)`;
  }
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES (${A.company},${SECOND_BUSINESS},'Second business','salon')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${A.company},${OTHER},${SECOND_BUSINESS},'Other business service','0.000','ZERO')`;
  await owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${B.company},${FOREIGN_SERVICE},${B.business},'Foreign service','0.000','ZERO')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => OTHER } });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
async function rejects(work: Promise<unknown>, pattern: RegExp) {
  const error = await work.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(pattern);
}

it.each(['package_types', 'package_type_components'])(
  '%s forces tenant isolation and hides rows without tenant context',
  async (table) => {
    expect(
      await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${table}`,
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect(
      Array.from(
        await asA(
          sql`SELECT company_id FROM ${sql.identifier(table)} WHERE company_id=${B.company}`,
        ),
      ),
    ).toEqual([]);
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      expect(await app.unsafe(`SELECT company_id FROM ${table}`)).toEqual([]);
    } finally {
      await app.end();
    }
  },
);
it('same identifiers in two tenants do not collide or expose foreign rows', async () => {
  expect(
    Array.from(await asA(sql`SELECT company_id,id FROM package_types WHERE id=${ID}`)),
  ).toEqual([{ company_id: A.company, id: ID }]);
  expect(
    Array.from(await asA(sql`SELECT company_id,id FROM package_type_components WHERE id=${ID}`)),
  ).toEqual([{ company_id: A.company, id: ID }]);
});
it('component identity is tenant qualified and a service cannot repeat under another id', async () => {
  expect(
    await owner`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid='package_type_components'::regclass AND contype='p'`,
  ).toEqual([{ definition: 'PRIMARY KEY (company_id, id)' }]);
  await rejects(
    asA(sql`INSERT INTO package_type_components(company_id,id,business_id,package_type_id,service_id,sessions,position)
      VALUES (${A.company},${OTHER},${A.business},${ID},${ID},1,2)`),
    /package_type_components_type_service_key/,
  );
});
it('cross-tenant inserts and upserts cannot write either table', async () => {
  await rejects(
    asA(sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${B.company},${OTHER},${B.business},'Foreign','0.000',1)`),
    /row-level security/,
  );
  await rejects(
    asA(sql`INSERT INTO package_type_components(company_id,id,business_id,package_type_id,service_id,sessions,position)
    VALUES (${B.company},${OTHER},${B.business},${ID},${ID},1,1)`),
    /row-level security/,
  );
  await rejects(
    asA(sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${B.company},${ID},${B.business},'Foreign','0.000',1)
    ON CONFLICT(company_id,id) DO UPDATE SET name_en=excluded.name_en`),
    /row-level security/,
  );
});
it('cross-tenant updates and deletes are invisible and identities cannot be reassigned', async () => {
  expect(
    Array.from(
      await asA(
        sql`UPDATE package_types SET price='0.000' WHERE company_id=${B.company} RETURNING id`,
      ),
    ),
  ).toEqual([]);
  expect(
    Array.from(
      await asA(
        sql`DELETE FROM package_type_components WHERE company_id=${B.company} RETURNING service_id`,
      ),
    ),
  ).toEqual([]);
  await rejects(
    asA(sql`UPDATE package_types SET company_id=${B.company} WHERE id=${ID}`),
    /permission denied/,
  );
  await rejects(
    asA(sql`UPDATE package_types SET business_id=${B.business} WHERE id=${ID}`),
    /permission denied/,
  );
  await rejects(
    asA(sql`UPDATE package_type_components SET sessions=2 WHERE company_id=${A.company}`),
    /permission denied/,
  );
  await rejects(
    asA(sql`DELETE FROM package_types WHERE company_id=${A.company}`),
    /permission denied/,
  );
});
it('foreign company and foreign business services and package parents fail composite FKs', async () => {
  for (const [business, service] of [
    [A.business, FOREIGN_SERVICE],
    [A.business, OTHER],
    [B.business, OTHER],
  ]) {
    await rejects(
      asA(sql`INSERT INTO package_type_components(company_id,id,business_id,package_type_id,service_id,sessions,position)
      VALUES (${A.company},${OTHER},${business ?? ''},${ID},${service ?? ''},1,2)`),
      /package_type_components_(service|type)_fk/,
    );
  }
  await rejects(
    asA(sql`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES (${A.company},${OTHER},${B.business},'Foreign business','0.000',1)`),
    /package_types_business_fk/,
  );
});
it('only component replacement has DELETE, and remains tenant filtered', async () => {
  expect(
    Array.from(
      await asA(
        sql`DELETE FROM package_type_components WHERE package_type_id=${ID} RETURNING company_id`,
      ),
    ),
  ).toEqual([{ company_id: A.company }]);
  expect(
    await owner`SELECT company_id FROM package_type_components WHERE company_id=${B.company}`,
  ).toEqual([{ company_id: B.company }]);
});
it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  '%s cannot access either table',
  async (url) => {
    const other = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      for (const table of ['package_types', 'package_type_components'])
        await expect(other.unsafe(`SELECT company_id FROM ${table}`)).rejects.toThrow(
          /permission denied/,
        );
    } finally {
      await other.end();
    }
  },
);
it.each([
  ['price', 'NaN', 'price_nonnegative'],
  ['validity_days', '0', 'validity_days'],
  ['validity_days', '731', 'validity_days'],
  ['revision', '0', 'revision_positive'],
  ['name_en', 'a\u0001b', 'name_en_controls'],
  ['name_ar', ' ', 'name_ar_length'],
])('database checks %s = %s', async (column, value, constraint) => {
  await rejects(
    asA(sql`UPDATE package_types SET ${sql.identifier(column)}=${value} WHERE id=${ID}`),
    new RegExp(constraint),
  );
});
it.each([
  [0, 1, 'sessions'],
  [366, 1, 'sessions'],
  [1, 0, 'position'],
  [1, 21, 'position'],
])('checks component sessions %s and position %s', async (sessions, position, constraint) => {
  await rejects(
    asA(sql`INSERT INTO package_type_components(company_id,id,business_id,package_type_id,service_id,sessions,position)
    VALUES (${A.company},${OTHER},${A.business},${ID},${ID},${sessions},${position})`),
    new RegExp(`package_type_components_${constraint}`),
  );
});
