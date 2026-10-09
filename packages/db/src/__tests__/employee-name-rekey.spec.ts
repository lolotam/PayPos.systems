import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import { rekeyEmployeeNameKeys } from '../data-steps/employee-name-keys.ts';

let testDb: TestDatabase, owner: postgres.Sql, app: Database;
const fixtures = [
  { en: 'Legacy', ar: 'سَارة', enKey: null, arKey: null, deleted: false, wrong: true },
  { en: 'İ', ar: null, enKey: 'i', arKey: null, deleted: false, wrong: true },
  { en: 'ΑΣ', ar: null, enKey: 'ασ', arKey: null, deleted: false, wrong: true },
  {
    en: 'Sara',
    ar: 'هبة',
    enKey: employeeNameMatchKey('Sara'),
    arKey: 'wrong',
    deleted: false,
    wrong: true,
  },
  {
    en: 'Correct',
    ar: 'إيمان',
    enKey: employeeNameMatchKey('Correct'),
    arKey: employeeNameMatchKey('إيمان'),
    deleted: false,
    wrong: false,
  },
  {
    en: 'Deleted',
    ar: null,
    enKey: employeeNameMatchKey('Deleted'),
    arKey: 'stale',
    deleted: true,
    wrong: true,
  },
].map((row) => ({ ...row, id: systemUuidV7().newId() }));

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 1 });
  await owner`ALTER TABLE employees DROP CONSTRAINT employees_name_en_key_present`;
  for (const tenant of Object.values(TENANT)) {
    for (const row of fixtures) {
      await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_ar,name_en_key,name_ar_key,role_code,hire_date,deleted_at)
        VALUES(${tenant.company},${row.id},${tenant.business},${tenant.branch},${row.en},${row.ar},${row.enKey},${row.arKey},'staff','2026-01-01',${row.deleted ? '2026-09-01T00:00:00Z' : null})`;
    }
  }
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function rowsWithVersions() {
  const rows = [];
  for (const { company } of Object.values(TENANT)) {
    rows.push(
      ...(await app.withTenant(company, (tx) =>
        tx.execute<{
          company_id: string;
          id: string;
          name_en: string;
          name_ar: string | null;
          name_en_key: string | null;
          name_ar_key: string | null;
          version: string;
        }>(sql`SELECT company_id,id,name_en,name_ar,name_en_key,name_ar_key,xmin::text AS version
      FROM employees WHERE company_id=${company} ORDER BY id`),
      )),
    );
  }
  return rows;
}

it('re-keys all tenant batches, preserves correct rows and resumes idempotently before validation', async () => {
  const before = await rowsWithVersions();
  const updated = 2 * fixtures.filter((row) => row.wrong).length;
  expect(await rekeyEmployeeNameKeys(owner, app, 2)).toEqual({ companies: 2, read: 12, updated });
  const after = await rowsWithVersions();
  expect(after).toHaveLength(12);
  for (const row of after) {
    expect(row.name_en_key).toBe(employeeNameMatchKey(row.name_en));
    expect(row.name_ar_key).toBe(row.name_ar === null ? null : employeeNameMatchKey(row.name_ar));
    const previous = before.find((old) => old.company_id === row.company_id && old.id === row.id);
    const fixture = fixtures.find((item) => item.id === row.id);
    if (previous === undefined || fixture === undefined) throw new Error('Missing fixture row');
    if (fixture.wrong) expect(row.version).not.toBe(previous.version);
    else expect(row.version).toBe(previous.version);
  }
  expect(await rekeyEmployeeNameKeys(owner, app, 2)).toEqual({
    companies: 2,
    read: 12,
    updated: 0,
  });
  expect(await rowsWithVersions()).toEqual(after);
  await owner`ALTER TABLE employees ADD CONSTRAINT employees_name_en_key_present CHECK (name_en_key IS NOT NULL) NOT VALID`;
  await owner`ALTER TABLE employees VALIDATE CONSTRAINT employees_name_en_key_present`;
  expect(
    await owner`SELECT convalidated FROM pg_constraint WHERE conname='employees_name_en_key_present'`,
  ).toEqual([{ convalidated: true }]);
});

it('rejects a NULL English key through the app on the normal migrated template', async () => {
  const normal = await createTestDatabase();
  const database = createDatabase({ url: normal.appUrl, ids: systemUuidV7(), maxConnections: 1 });
  try {
    await seedTwoTenants(normal.ownerUrl);
    const { company, business, branch } = TENANT.A;
    await expect(
      database.withTenant(company, (tx) =>
        tx.execute(sql`
      INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
      VALUES(${company},${systemUuidV7().newId()},${business},${branch},'Synthetic missing key',NULL,'staff','2026-01-01')`),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'employees_name_en_key_present' },
    });
  } finally {
    await database.close();
    await normal.drop();
  }
});
