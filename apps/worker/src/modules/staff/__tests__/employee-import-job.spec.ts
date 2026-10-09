import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeImportFixture, type EmployeeImportFixture } from './employee-import.fixture.ts';
import { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';
import { employeeImportTransactions } from '../persistence/employee-import.transactions.ts';
import { ImportCommitError } from '../domain/employee-import.ts';
import { systemUuidV7 } from '@pospay/ids';
import { employeeNameMatchKey } from '@pospay/domain';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.close();
});
const ids = systemUuidV7();

it.each([undefined, 'سَـارة إيمان'])(
  'stores domain keys for import with Arabic %s without auditing keys',
  async (nameAr) => {
    const nameEn = nameAr === undefined ? 'NULL Arabic Import' : 'ＳＡＲＡ  Import';
    const id = await f.requested(nameEn, nameAr === undefined ? {} : { nameAr });
    await f.worker.execute(f.company, id);
    const [row] =
      await f.owner`SELECT id,name_en_key,name_ar_key FROM employees WHERE company_id=${f.company} AND name_en=${nameEn}`;
    expect(row).toMatchObject({
      name_en_key: employeeNameMatchKey(nameEn),
      name_ar_key: nameAr === undefined ? null : employeeNameMatchKey(nameAr),
    });
    const [audit] =
      await f.owner`SELECT after FROM audit_log WHERE entity_id=${row?.['id']} AND action='imported'`;
    expect(audit?.['after']).not.toHaveProperty('name_en_key');
    expect(audit?.['after']).not.toHaveProperty('name_ar_key');
  },
);

async function requested(name: string) {
  return f.requested(name);
}

it('commits, stamps the request creator and Clock, and safely retries after a lost commit acknowledgement', async () => {
  const id = await requested('Worker happy');
  const transactions = employeeImportTransactions(f.db, ids);
  let crash = true;
  const worker = new CommitEmployeeImport(
    {
      ...transactions,
      run: async (...args) => {
        await transactions.run(...args);
        if (crash) {
          crash = false;
          throw new Error('Synthetic lost acknowledgement');
        }
      },
    },
    ids,
    { now: () => f.clock.value },
  );
  await expect(worker.execute(f.company, id)).rejects.toThrow('Synthetic lost acknowledgement');
  await worker.execute(f.company, id);
  const [status] = await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`;
  expect(status).toMatchObject({ status: 'committed', created_count: 1 });
  const [counts] =
    await f.owner`SELECT count(*)::int AS n FROM employees WHERE company_id=${f.company} AND name_en='Worker happy'`;
  expect(counts?.['n']).toBe(1);
  const [audit] =
    await f.owner`SELECT actor_user_id FROM audit_log WHERE company_id=${f.company} AND action='imported'`;
  expect(audit?.['actor_user_id']).toBe(f.userId);
});

it('rolls back every inserted row and event before recording a stable failed status', async () => {
  const id = await requested('Worker rollback');
  const transactions = employeeImportTransactions(f.db, ids);
  const worker = new CommitEmployeeImport(
    {
      ...transactions,
      run: (company, preview, work) =>
        transactions.run(company, preview, (scope) =>
          work({
            ...scope,
            complete: async () => {
              throw new ImportCommitError('EMPLOYEE_BRANCH_NOT_FOUND');
            },
          }),
        ),
    },
    ids,
    { now: () => f.clock.value },
  );
  await worker.execute(f.company, id);
  await f.worker.execute(f.company, id);
  const [status] =
    await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${id}`;
  expect(status).toMatchObject({
    status: 'failed',
    error_code: 'EMPLOYEE_BRANCH_NOT_FOUND',
    created_count: 0,
  });
  expect(
    await f.owner`SELECT id FROM employees WHERE company_id=${f.company} AND name_en='Worker rollback'`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND after->>'name_en'='Worker rollback'`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE company_id=${f.company} AND payload->>'name_en'='Worker rollback'`,
  ).toHaveLength(0);
});

it('cannot consume a preview from another tenant and checks expiry at acceptance under the worker lock', async () => {
  const id = await requested('Worker tenant');
  const otherCompany = f.otherCompany;
  await f.worker.execute(otherCompany, id);
  const [unchanged] = await f.owner`SELECT status FROM import_previews WHERE id=${id}`;
  expect(unchanged?.['status']).toBe('commit_requested');
  await f.owner`UPDATE import_previews SET requested_at=expires_at WHERE id=${id}`;
  await f.worker.execute(f.company, id);
  const [failed] = await f.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`;
  expect(failed).toMatchObject({ status: 'failed', error_code: 'IMPORT_PREVIEW_EXPIRED' });
});

it('honours a request accepted just before expiry even when execution happens after expiry', async () => {
  const id = await f.requested('Delayed accepted', {
    requestedAt: new Date('2026-10-06T09:59:59.999Z'),
  });
  const worker = new CommitEmployeeImport(employeeImportTransactions(f.db, ids), ids, {
    now: () => new Date('2026-10-06T10:01:00Z'),
  });
  await worker.execute(f.company, id);
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'committed',
  );
});

it('commits 500 immutable rows once with all audits/events at the injected instant', async () => {
  const id = await f.requested('Worker batch', { count: 500 });
  await Promise.all([f.worker.execute(f.company, id), f.worker.execute(f.company, id)]);
  expect(
    (await f.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({ status: 'committed', created_count: 500 });
  const [summary] =
    await f.owner`SELECT payload FROM outbox WHERE aggregate_id=${id} AND event_type='ImportCommitted'`;
  const payload = summary?.['payload'] as { employee_ids: string[]; committed_at: string };
  expect(payload.committed_at).toBe(f.clock.value.toISOString());
  expect(
    (
      await f.owner`SELECT count(*)::int AS n FROM audit_log WHERE entity_id=ANY(${payload.employee_ids}::uuid[])`
    )[0]?.['n'],
  ).toBe(500);
  expect(
    (
      await f.owner`SELECT count(*)::int AS n FROM outbox WHERE aggregate_id=ANY(${payload.employee_ids}::uuid[])`
    )[0]?.['n'],
  ).toBe(500);
  const [employee] =
    await f.owner`SELECT created_at FROM employees WHERE id=${payload.employee_ids[0] as string}`;
  expect(new Date(employee?.['created_at']).toISOString()).toBe(payload.committed_at);
});

it('fails missing branches without partial writes but accepts inactive renamed branch ids', async () => {
  const missing = await f.requested('Missing branch', { branchId: ids.newId() });
  await f.worker.execute(f.company, missing);
  expect(
    (await f.owner`SELECT status,error_code FROM import_previews WHERE id=${missing}`)[0],
  ).toMatchObject({ status: 'failed', error_code: 'EMPLOYEE_BRANCH_NOT_FOUND' });
  expect(await f.owner`SELECT id FROM employees WHERE name_en='Missing branch'`).toHaveLength(0);
  await f.owner`UPDATE branches SET is_active=false,name_en='Renamed' WHERE id=${f.branch}`;
  const inactive = await f.requested('Inactive branch');
  await f.worker.execute(f.company, inactive);
  expect(
    (await f.owner`SELECT status FROM import_previews WHERE id=${inactive}`)[0]?.['status'],
  ).toBe('committed');
});
