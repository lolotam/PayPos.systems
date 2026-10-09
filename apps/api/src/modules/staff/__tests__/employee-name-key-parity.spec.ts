import { readFileSync } from 'node:fs';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNameKeyVectors } from '../../../../../../packages/domain/src/__tests__/employee-name-key.vectors.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';

const migration = readFileSync(
  new URL(
    '../../../../../../packages/db/migrations/0096_2026-10-09_staff-employee-name-keys.sql',
    import.meta.url,
  ),
  'utf8',
);
const backfill = migration.slice(migration.indexOf('UPDATE employees SET')).trim();
const expressions =
  /^UPDATE employees SET\s+name_en_key = ([\s\S]+),\s+name_ar_key = ([\s\S]+);$/.exec(backfill);
if (expressions?.[1] === undefined || expressions[2] === undefined)
  throw new Error('Name-key migration backfill could not be extracted');
const enExpression = expressions[1];
const arExpression = expressions[2];
let testDb: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

it.each(employeeNameKeyVectors)(
  'the migration expressions match the domain for %j',
  async (name) => {
    const [row] = await owner.unsafe(
      `SELECT ${enExpression} AS en, ${arExpression} AS ar FROM (SELECT $1::text AS name_en, $1::text AS name_ar) names`,
      [name],
    );
    expect(row).toEqual({ en: employeeNameMatchKey(name), ar: employeeNameMatchKey(name) });
  },
);

it.each([null, 'سَـارة إيمان'])(
  'backfills a legacy row and preserves nullable Arabic %s',
  async (nameAr) => {
    const { company, business, branch } = TENANT.A;
    const id = systemUuidV7().newId();
    const nameEn = 'ＳＡＲＡ  Ahmed';
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_ar,role_code,hire_date)
    VALUES(${company},${id},${business},${branch},${nameEn},${nameAr},'staff','2026-01-01')`;
    expect(await owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${id}`).toEqual([
      { name_en_key: null, name_ar_key: null },
    ]);
    await owner.unsafe(backfill);
    expect(await owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${id}`).toEqual([
      {
        name_en_key: employeeNameMatchKey(nameEn),
        name_ar_key: nameAr === null ? null : employeeNameMatchKey(nameAr),
      },
    ]);
  },
);
