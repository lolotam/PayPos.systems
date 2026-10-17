import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import {
  assignEmployeeNumbers,
  EmployeeNumbersExhaustedError,
  EmployeeNumbersRoleRefusedError,
} from '../data-steps/employee-numbers.ts';

const { A, B } = TENANT;
type Tenant = typeof A | typeof B;
type Tx = Parameters<Parameters<Database['withTenant']>[1]>[0];
let testDb: TestDatabase, owner: postgres.Sql, app: Database;

interface Seed {
  readonly name: string;
  readonly hire: string;
  readonly created?: string;
  readonly deleted?: boolean;
  readonly number?: number;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 1 });
});
beforeEach(async () => {
  await owner`DELETE FROM employee_number_sequences`;
  await owner`DELETE FROM attendance_states`;
  await owner`DELETE FROM employees`;
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function insert(tenant: Tenant, seed: Seed): Promise<string> {
  const id = systemUuidV7().newId();
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,created_at,deleted_at,employee_number)
    VALUES (${tenant.company},${id},${tenant.business},${tenant.branch},${seed.name},${employeeNameMatchKey(seed.name)},'staff',${seed.hire},
      ${seed.created ?? '2026-01-01T00:00:00Z'},${seed.deleted === true ? '2026-09-01T00:00:00Z' : null},${seed.number ?? null})`;
  return id;
}

async function numbers(tenant: Tenant): Promise<Record<string, number | null>> {
  const rows = await owner<{ name_en: string; employee_number: number | null }[]>`
    SELECT name_en, employee_number FROM employees WHERE company_id = ${tenant.company}`;
  return Object.fromEntries(rows.map((row) => [row.name_en, row.employee_number]));
}

async function counter(tenant: Tenant): Promise<number | undefined> {
  const [row] = await owner<{ next_number: number }[]>`
    SELECT next_number FROM employee_number_sequences WHERE company_id = ${tenant.company}`;
  return row?.next_number;
}

it('EN-01 numbers by hire date, then creation time, deleted included, and starts the counter after the last', async () => {
  await insert(A, { name: 'Reem', hire: '2026-10-01' });
  await insert(A, { name: 'Bea', hire: '2025-05-01', created: '2026-01-02T00:00:00Z' });
  await insert(A, { name: 'Heba', hire: '2025-03-01' });
  await insert(A, { name: 'Aya', hire: '2025-05-01', created: '2026-01-01T00:00:00Z' });
  await insert(A, { name: 'Dalal', hire: '2025-02-01', deleted: true });
  await insert(A, { name: 'Sara', hire: '2025-01-05' });
  const counts = await assignEmployeeNumbers(owner, app);
  expect(counts).toMatchObject({ companies: 2, read: 6, assigned: 6, exhausted: 0 });
  expect(await numbers(A)).toEqual({ Sara: 1, Dalal: 2, Heba: 3, Aya: 4, Bea: 5, Reem: 6 });
  expect(await counter(A)).toBe(7);
});

it('EN-02 numbers each company from 1 on its own (the Sara, Heba, Reem example)', async () => {
  await insert(A, { name: 'Other', hire: '2020-01-01' });
  await insert(B, { name: 'Reem', hire: '2026-10-01' });
  await insert(B, { name: 'Sara', hire: '2025-01-05' });
  await insert(B, { name: 'Heba', hire: '2025-03-01' });
  await assignEmployeeNumbers(owner, app);
  expect(await numbers(B)).toEqual({ Sara: 1, Heba: 2, Reem: 3 });
  expect(await counter(B)).toBe(4);
  expect(await numbers(A)).toEqual({ Other: 1 });
});

it('EN-02 is idempotent: a second run assigns nothing and changes no number', async () => {
  await insert(A, { name: 'Sara', hire: '2025-01-05' });
  await insert(A, { name: 'Heba', hire: '2025-03-01' });
  await assignEmployeeNumbers(owner, app);
  const before = await numbers(A);
  const again = await assignEmployeeNumbers(owner, app);
  expect(again).toMatchObject({ assigned: 0 });
  expect(await numbers(A)).toEqual(before);
  expect(await counter(A)).toBe(3);
});

it('numbers across several small batches in the same order, skipping a hand number and applying each batch in one statement', async () => {
  await insert(A, { name: 'E', hire: '2025-05-01' });
  await insert(A, { name: 'Hand', hire: '2025-01-01', number: 2 });
  await insert(A, { name: 'C', hire: '2025-03-01' });
  await insert(A, { name: 'A', hire: '2025-01-02' });
  await insert(A, { name: 'D', hire: '2025-04-01' });
  await insert(A, { name: 'B', hire: '2025-02-01' });
  const counts = await assignEmployeeNumbers(owner, app, 2);
  expect(counts).toMatchObject({ read: 5, assigned: 5, exhausted: 0 });
  expect(await numbers(A)).toEqual({ A: 1, Hand: 2, B: 3, C: 4, D: 5, E: 6 });
  expect(await counter(A)).toBe(7);
});

it('does not overwrite a number written after the batch was read, and keeps going while null rows remain', async () => {
  await insert(A, { name: 'Raced', hire: '2025-01-01' });
  await insert(A, { name: 'After', hire: '2025-02-01' });
  const locker = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    let locked!: () => void;
    let release!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    const writer = locker.begin(async (tx) => {
      await tx`UPDATE employees SET employee_number = 500 WHERE company_id = ${A.company} AND name_en = 'Raced'`;
      locked();
      await mayCommit;
    });
    await lockTaken;
    const run = assignEmployeeNumbers(owner, app, 1);
    for (let waits = 0; waits < 200; waits++) {
      const [blocked] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((blocked?.n ?? 0) > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await writer;
    const counts = await run;
    expect(counts).toMatchObject({ read: 2, assigned: 1, exhausted: 0 });
  } finally {
    await locker.end();
  }
  expect(await numbers(A)).toEqual({ Raced: 500, After: 2 });
});

it('skips a hand-typed number without letting it move the counter', async () => {
  await insert(A, { name: 'Hand', hire: '2025-01-01', number: 1050 });
  await insert(A, { name: 'One', hire: '2025-02-01' });
  await insert(A, { name: 'Two', hire: '2025-03-01' });
  await insert(A, { name: 'Three', hire: '2025-04-01' });
  await assignEmployeeNumbers(owner, app);
  expect(await numbers(A)).toEqual({ Hand: 1050, One: 1, Two: 2, Three: 3 });
  expect(await counter(A)).toBe(4);
});

it('never moves the counter back and steps over used numbers at or above it', async () => {
  await owner`INSERT INTO employee_number_sequences(company_id,next_number) VALUES (${A.company},1000)`;
  await insert(A, { name: 'Taken', hire: '2025-01-01', number: 1001 });
  await insert(A, { name: 'First', hire: '2025-02-01' });
  await insert(A, { name: 'Second', hire: '2025-03-01' });
  await assignEmployeeNumbers(owner, app);
  expect(await numbers(A)).toEqual({ Taken: 1001, First: 1000, Second: 1002 });
  expect(await counter(A)).toBe(1003);
});

it('fails with a fixed message when the range is full, keeps the migration retryable and numbers nobody wrongly', async () => {
  await owner`INSERT INTO employee_number_sequences(company_id,next_number) VALUES (${A.company},999999)`;
  await insert(A, { name: 'Last', hire: '2025-01-01', number: 999999 });
  await insert(A, { name: 'Late', hire: '2025-02-01' });
  const failure = await assignEmployeeNumbers(owner, app).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(EmployeeNumbersExhaustedError);
  expect((failure as Error).message).not.toMatch(/Late|Last/);
  expect((await numbers(A)).Late).toBeNull();
  await owner`UPDATE employees SET employee_number = 5 WHERE company_id = ${A.company} AND name_en = 'Last'`;
  await owner`UPDATE employee_number_sequences SET next_number = 1 WHERE company_id = ${A.company}`;
  await expect(assignEmployeeNumbers(owner, app)).resolves.toMatchObject({ exhausted: 0 });
  expect((await numbers(A)).Late).toBe(1);
});

it('refuses a migration role that is neither superuser nor BYPASSRLS, with a fixed message', async () => {
  const plain = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(assignEmployeeNumbers(plain, app)).rejects.toBeInstanceOf(
      EmployeeNumbersRoleRefusedError,
    );
  } finally {
    await plain.end();
  }
});

it('the unique index rejects a repeat inside one company, deleted employees included, and allows it across companies', async () => {
  await insert(A, { name: 'Alive', hire: '2025-01-01', number: 7 });
  await expect(insert(A, { name: 'Twin', hire: '2025-01-01', number: 7 })).rejects.toMatchObject({
    code: '23505',
  });
  await insert(A, { name: 'Gone', hire: '2025-01-01', number: 8, deleted: true });
  await expect(insert(A, { name: 'Reuse', hire: '2025-01-01', number: 8 })).rejects.toMatchObject({
    code: '23505',
  });
  await expect(insert(B, { name: 'Elsewhere', hire: '2025-01-01', number: 7 })).resolves.toBeTypeOf(
    'string',
  );
});

it.each([0, 1_000_000])('the employee_number check rejects %s', async (value) => {
  await expect(insert(A, { name: 'Bad', hire: '2025-01-01', number: value })).rejects.toMatchObject(
    {
      code: '23514',
    },
  );
});

it('employee_number_sequences is FORCE RLS: cross-tenant read, insert, update and delete all fail', async () => {
  const [flags] =
    await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'employee_number_sequences'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await owner`INSERT INTO employee_number_sequences(company_id,next_number) VALUES (${B.company},5)`;
  const asA = <T>(work: (tx: Tx) => Promise<T>) => app.withTenant(A.company, work);
  expect(
    await asA((tx) => tx.execute(sql`SELECT next_number FROM employee_number_sequences`)),
  ).toHaveLength(0);
  await expect(
    asA((tx) =>
      tx.execute(sql`INSERT INTO employee_number_sequences(company_id) VALUES (${B.company})`),
    ),
  ).rejects.toThrow();
  expect(
    await asA((tx) =>
      tx.execute(
        sql`UPDATE employee_number_sequences SET next_number = 9 WHERE company_id = ${B.company} RETURNING company_id`,
      ),
    ),
  ).toHaveLength(0);
  await expect(
    asA((tx) => tx.execute(sql`DELETE FROM employee_number_sequences`)),
  ).rejects.toThrow();
  await expect(
    asA((tx) =>
      tx.execute(
        sql`UPDATE employee_number_sequences SET company_id = ${A.company} WHERE company_id = ${B.company}`,
      ),
    ),
  ).rejects.toThrow();
  expect(await counter(B)).toBe(5);
});

it('the sequence checks reject a counter out of range and a half-set start', async () => {
  await expect(
    owner`INSERT INTO employee_number_sequences(company_id,next_number) VALUES (${A.company},0)`,
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    owner`INSERT INTO employee_number_sequences(company_id,next_number) VALUES (${A.company},1000001)`,
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    owner`INSERT INTO employee_number_sequences(company_id,start_number) VALUES (${A.company},1000)`,
  ).rejects.toMatchObject({ code: '23514' });
});
