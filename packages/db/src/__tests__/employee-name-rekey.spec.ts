import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import {
  MigrationRoleRefusedError,
  rekeyEmployeeNameKeys,
} from '../data-steps/employee-name-keys.ts';

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
});
beforeEach(async () => {
  await owner`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_name_en_key_present`;
  await owner`DELETE FROM attendance_states`;
  await owner`DELETE FROM employees`;
  for (const tenant of Object.values(TENANT)) {
    for (const row of fixtures) await insertEmployee(tenant, row);
  }
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function insertEmployee(tenant: (typeof TENANT)['A' | 'B'], row: (typeof fixtures)[number]) {
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_ar,name_en_key,name_ar_key,role_code,hire_date,deleted_at)
    VALUES(${tenant.company},${row.id},${tenant.business},${tenant.branch},${row.en},${row.ar},${row.enKey},${row.arKey},'staff','2026-01-01',${row.deleted ? '2026-09-01T00:00:00Z' : null})`;
}

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

type EmployeeRow = Awaited<ReturnType<typeof rowsWithVersions>>[number];

function hasCorrectKeys(row: EmployeeRow) {
  return (
    row.name_en_key === employeeNameMatchKey(row.name_en) &&
    row.name_ar_key === (row.name_ar === null ? null : employeeNameMatchKey(row.name_ar))
  );
}

function expectPreservedRows(before: EmployeeRow[], after: EmployeeRow[]) {
  for (const previous of before) {
    const row = after.find(
      (item) => item.company_id === previous.company_id && item.id === previous.id,
    );
    expect(row?.name_en).toBe(previous.name_en);
    expect(row?.name_ar).toBe(previous.name_ar);
    if (hasCorrectKeys(previous)) expect(row?.version).toBe(previous.version);
  }
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

it('refuses a migration role without BYPASSRLS before reading companies or updating a row', async () => {
  const before = await rowsWithVersions();
  expect(before.some((row) => !hasCorrectKeys(row))).toBe(true);
  const restricted = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    const failure = rekeyEmployeeNameKeys(restricted, app, 2);
    await expect(failure).rejects.toBeInstanceOf(MigrationRoleRefusedError);
    await expect(failure).rejects.toThrow(
      'Migration data step employee-name-keys needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
    await expect(failure).rejects.not.toThrow(/postgres:|pospay_app|password/i);
  } finally {
    await restricted.end();
  }
  expect(await rowsWithVersions()).toEqual(before);
});

it('resumes after interruption with committed batches and leaves correct rows untouched', async () => {
  const before = await rowsWithVersions();
  const wrongBefore = before.filter((row) => !hasCorrectKeys(row)).length;
  let calls = 0;
  const interrupted: Database = {
    ...app,
    withTenant: async (company, work, options) => {
      if (++calls === 2) throw new Error('Synthetic batch interruption');
      return app.withTenant(company, work, options);
    },
  };
  await expect(rekeyEmployeeNameKeys(owner, interrupted, 2)).rejects.toThrow(
    'Synthetic batch interruption',
  );
  const partial = await rowsWithVersions();
  const wrongRemaining = partial.filter((row) => !hasCorrectKeys(row)).length;
  expect(wrongRemaining).toBeGreaterThan(0);
  expect(wrongRemaining).toBeLessThan(wrongBefore);
  expectPreservedRows(before, partial);
  expect(await rekeyEmployeeNameKeys(owner, app, 2)).toEqual({
    companies: 2,
    read: 12,
    updated: wrongRemaining,
  });
  const after = await rowsWithVersions();
  expect(after).toHaveLength(12);
  expect(after.every(hasCorrectKeys)).toBe(true);
  expectPreservedRows(before, after);
  expectPreservedRows(partial.filter(hasCorrectKeys), after);
});

async function interleaveWrites(company: string, before: EmployeeRow[]) {
  const processed = before.filter((row) => row.company_id === company).slice(0, 2);
  const renamed = processed[0];
  if (renamed === undefined) throw new Error('Missing processed employee');
  const committed = await rowsWithVersions();
  expect(
    committed
      .filter((row) =>
        processed.some((old) => old.company_id === row.company_id && old.id === row.id),
      )
      .every(hasCorrectKeys),
  ).toBe(true);
  const other = Object.values(TENANT).find((tenant) => tenant.company !== company);
  const fixture = fixtures[0];
  if (other === undefined || fixture === undefined) throw new Error('Missing interleaving fixture');
  await insertEmployee(other, {
    ...fixture,
    id: systemUuidV7().newId(),
    en: 'Inserted fixture',
    ar: null,
    enKey: 'stale',
    arKey: null,
  });
  const newName = 'Renamed fixture';
  await owner`UPDATE employees SET name_en=${newName}, name_en_key=${employeeNameMatchKey(newName)}
    WHERE company_id=${company} AND id=${renamed.id}`;
  return { ...renamed, name_en: newName };
}

it('preserves interleaved renames and re-keys an insert in the other tenant', async () => {
  const before = await rowsWithVersions();
  let calls = 0;
  let renamed: EmployeeRow | undefined;
  const interleaved: Database = {
    ...app,
    withTenant: async (company, work, options) => {
      const result = await app.withTenant(company, work, options);
      if (++calls === 1) renamed = await interleaveWrites(company, before);
      return result;
    },
  };
  expect(await rekeyEmployeeNameKeys(owner, interleaved, 2)).toEqual({
    companies: 2,
    read: 13,
    updated: 11,
  });
  const afterFirst = await rowsWithVersions();
  const wrongRemaining = afterFirst.filter((row) => !hasCorrectKeys(row)).length;
  // الشركة الأخرى لم تُقرأ بعد، لذا يصل المرور الأول إلى الصف المُضاف أيضاً.
  expect(wrongRemaining).toBe(0);
  expect(await rekeyEmployeeNameKeys(owner, app, 2)).toEqual({
    companies: 2,
    read: 13,
    updated: wrongRemaining,
  });
  const after = await rowsWithVersions();
  expect(after).toEqual(afterFirst);
  expect(after.every(hasCorrectKeys)).toBe(true);
  const renamedRow = renamed;
  if (renamedRow === undefined) throw new Error('Interleaved writes did not run');
  expect(
    after.find((row) => row.company_id === renamedRow.company_id && row.id === renamedRow.id),
  ).toMatchObject({
    name_en: renamedRow.name_en,
    name_en_key: employeeNameMatchKey(renamedRow.name_en),
  });
  expectPreservedRows(
    before.filter((row) => row.company_id !== renamedRow.company_id || row.id !== renamedRow.id),
    after,
  );
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
