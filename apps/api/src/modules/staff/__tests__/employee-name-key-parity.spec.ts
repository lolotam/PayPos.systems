import { readFileSync } from 'node:fs';
import { createDatabase } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeNameKeyUnicodeCaseVectors,
  employeeNameKeyVectors,
} from '../../../../../../packages/domain/src/__tests__/employee-name-key.vectors.ts';
import { rekeyEmployeeNameKeys } from '../../../../../../packages/db/src/data-steps/employee-name-keys.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';

const migration = readFileSync(
  new URL(
    '../../../../../../packages/db/migrations/0097_2026-10-09_staff-employee-name-keys.sql',
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
  await owner`ALTER TABLE employees DROP CONSTRAINT employees_name_en_key_present`;
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

// يختلف lower() عن toLowerCase في İ وسيجما النهائية، ومع C في كل حرف غير ASCII؛
// الفجوة مقبولة لأن 0097 تاريخ ثابت وتعيد خطوة TypeScript حساب المفاتيح وفق ADR-0038.
it.each(employeeNameKeyUnicodeCaseVectors)(
  're-keys the historical SQL result for %j',
  async (name) => {
    const { company, business, branch } = TENANT.A;
    const id = systemUuidV7().newId();
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_ar,role_code,hire_date)
    VALUES(${company},${id},${business},${branch},${name},${name},'staff','2026-01-01')`;
    await owner.unsafe(backfill);
    const app = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 1 });
    try {
      await rekeyEmployeeNameKeys(owner, app);
      expect(await owner`SELECT name_en_key,name_ar_key FROM employees WHERE id=${id}`).toEqual([
        { name_en_key: employeeNameMatchKey(name), name_ar_key: employeeNameMatchKey(name) },
      ]);
    } finally {
      await app.close();
    }
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
