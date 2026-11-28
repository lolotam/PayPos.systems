import { assignEmployeeNumber, type TenantWrappers, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { employeeImportFixture, type EmployeeImportFixture } from './employee-import.fixture.ts';
import { employeeImportTransactions } from '../persistence/employee-import.transactions.ts';
import { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';

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

it('allocates a multi-row import with O(1) counter and used-number SQL statements', async () => {
  const dialect = new PgDialect();
  async function countStatements(rowCount: number) {
    const queries: string[] = [];
    const spiedDb: Pick<TenantWrappers, 'withTenant'> = {
      withTenant: (companyId, work, options) =>
        f.db.withTenant(
          companyId,
          (tx) => {
            const execute = tx.execute.bind(tx);
            const spiedTx = new Proxy(tx, {
              get(target, prop, receiver) {
                if (prop === 'execute') {
                  return (query: SQL) => {
                    queries.push(dialect.sqlToQuery(query).sql);
                    return execute(query);
                  };
                }
                return Reflect.get(target, prop, receiver);
              },
            }) as Tx;
            return work(spiedTx);
          },
          options,
        ),
    };
    const worker = new CommitEmployeeImport(employeeImportTransactions(spiedDb, f.ids), f.ids, {
      now: () => f.clock.value,
    });
    const id = await f.requested(`SqlCount ${rowCount}`, { count: rowCount });
    await worker.execute(f.company, id);
    return queries;
  }

  await setCounter(20_000);
  const smallQueries = await countStatements(2);
  await setCounter(21_000);
  const batchQueries = await countStatements(25);

  expect(batchQueries).toHaveLength(smallQueries.length);
  const counterQueries = batchQueries.filter((q) => q.includes('employee_number_sequences'));
  const usedNumberQueries = batchQueries.filter((q) =>
    q.includes('SELECT employee_number FROM employees'),
  );
  expect(counterQueries).toHaveLength(3);
  expect(usedNumberQueries).toHaveLength(1);
  expect(await numbersNamed('SqlCount 25')).toEqual(
    Array.from({ length: 25 }, (_, i) => 21_000 + i),
  );
  expect(await readCounter()).toBe(21_025);
});

it('succeeds at the exact 999999 boundary and rolls back when a gap pushes the batch past 999999', async () => {
  await setCounter(999_998);
  const exactId = await f.requested('Exact', { names: ['Exact A', 'Exact B'] });
  await f.worker.execute(f.company, exactId);
  expect(await numbersNamed('Exact A')).toEqual([999_998]);
  expect(await numbersNamed('Exact B')).toEqual([999_999]);
  expect(await readCounter()).toBe(1_000_000);

  await setCounter(999_997);
  const before = await readCounter();
  const failId = await f.requested('BoundaryFail', { names: ['Gap A', 'Gap B', 'Gap C'] });
  await f.worker.execute(f.company, failId);
  const [status] = await f.owner`SELECT status, error_code, created_count FROM import_previews WHERE id=${failId}`;
  expect(status).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_COMMIT_FAILED',
    created_count: 0,
  });
  expect(await numbersNamed('Gap A')).toEqual([]);
  expect(await readCounter()).toBe(before);
});
