import { assignEmployeeNumber } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { employeeImportFixture, type EmployeeImportFixture } from './employee-import.fixture.ts';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.close();
});

async function setCounter(next: number) {
  await f.owner`INSERT INTO employee_number_sequences (company_id, next_number)
    VALUES (${f.company}, ${next})
    ON CONFLICT (company_id) DO UPDATE SET next_number = ${next}, updated_at = now()`;
}

async function readCounter() {
  const [row] = await f.owner<{ next_number: number }[]>`
    SELECT next_number FROM employee_number_sequences WHERE company_id=${f.company}`;
  return Number(row?.next_number);
}

async function numbersNamed(name: string) {
  const rows = await f.owner<{ employee_number: number }[]>`
    SELECT employee_number FROM employees WHERE company_id=${f.company} AND name_en=${name}
    ORDER BY employee_number`;
  return rows.map((row) => Number(row.employee_number));
}

it('EN-13 numbers three imported rows in file order, skips a hand-typed number, and advances the counter', async () => {
  await setCounter(10);
  await f.owner`INSERT INTO employees (
      company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date,
      employee_number)
    VALUES (${f.company}, ${f.ids.newId()}, ${f.business}, ${f.branch},
      'Held 11', 'held-11', 'staff', '2020-01-01', 11)`;
  const id = await f.requested('ignored', { names: ['Zed', 'Amy', 'Moe'] });
  await f.worker.execute(f.company, id);
  expect(await numbersNamed('Zed')).toEqual([10]);
  expect(await numbersNamed('Amy')).toEqual([12]);
  expect(await numbersNamed('Moe')).toEqual([13]);
  expect(await readCounter()).toBe(14);
  const [audit] = await f.owner<{ after: { employee_number: number } }[]>`
    SELECT after FROM audit_log WHERE company_id=${f.company} AND action='imported' AND after->>'name_en'='Zed'`;
  expect(audit?.after.employee_number).toBe(10);
});

it('an import that exhausts the range rolls back and records IMPORT_COMMIT_FAILED', async () => {
  await setCounter(999_998);
  const before = await readCounter();
  const id = await f.requested('ignored', { names: ['Exhaust A', 'Exhaust B', 'Exhaust C'] });
  await f.worker.execute(f.company, id);
  const [status] = await f.owner`SELECT status, error_code, created_count FROM import_previews WHERE id=${id}`;
  expect(status).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_COMMIT_FAILED',
    created_count: 0,
  });
  expect(await numbersNamed('Exhaust A')).toEqual([]);
  expect(await numbersNamed('Exhaust B')).toEqual([]);
  expect(await numbersNamed('Exhaust C')).toEqual([]);
  expect(await readCounter()).toBe(before);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND after->>'name_en'='Exhaust A'`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE company_id=${f.company} AND payload->>'name_en'='Exhaust A'`,
  ).toHaveLength(0);
});

it('two imports serialise on the counter and do not repeat a number', async () => {
  await setCounter(8000);
  const first = await f.requested('Import one');
  const second = await f.requested('Import two');
  await Promise.all([f.worker.execute(f.company, first), f.worker.execute(f.company, second)]);
  const numbers = [...(await numbersNamed('Import one')), ...(await numbersNamed('Import two'))];
  expect(numbers.sort((left, right) => left - right)).toEqual([8000, 8001]);
  expect(await readCounter()).toBe(8002);
});

it('an import and a create-employee assignment serialise on the counter', async () => {
  await setCounter(7000);
  const id = await f.requested('Race import', { count: 3 });
  const created = f.db.withTenant(f.company, async (tx) => {
    const employeeNumber = await assignEmployeeNumber(tx, f.company);
    await tx.execute(sql`INSERT INTO employees (
        company_id, id, business_id, primary_branch_id, name_en, name_en_key, role_code, hire_date,
        employee_number)
      VALUES (${f.company}, ${f.ids.newId()}, ${f.business}, ${f.branch},
        'Race created', 'race-created', 'staff', '2026-01-01', ${employeeNumber})`);
    return employeeNumber;
  });
  await Promise.all([f.worker.execute(f.company, id), created]);
  const numbers = [...(await numbersNamed('Race import')), ...(await numbersNamed('Race created'))];
  expect(numbers.sort((left, right) => left - right)).toEqual([7000, 7001, 7002, 7003]);
  expect(await readCounter()).toBe(7004);
});
