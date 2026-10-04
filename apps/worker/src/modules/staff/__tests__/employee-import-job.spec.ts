import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
  commitCommand,
  type EmployeeImportFixture,
} from '../../../../../api/src/modules/staff/__tests__/employee-import.fixture.ts';
import { CommitEmployeeImport } from '../use-cases/commit-employee-import/commit-employee-import.ts';
import { employeeImportTransactions } from '../persistence/employee-import.transactions.ts';
import { ImportCommitError } from '../domain/employee-import.ts';
import { systemUuidV7 } from '@pospay/ids';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.h.close();
});
const ids = systemUuidV7();

async function requested(name: string) {
  const preview = await f.preview.execute(
    previewCommand(
      f,
      await f.upload(await employeeWorkbook([[name, null, 'staff', '2026-01-01', null, 'Main']])),
    ),
  );
  await f.commit.execute(commitCommand(f, preview.preview_id, ids.newId()));
  return preview.preview_id;
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
  const [status] = await f.h.owner`SELECT status,created_count FROM import_previews WHERE id=${id}`;
  expect(status).toMatchObject({ status: 'committed', created_count: 1 });
  const [counts] = await f.h
    .owner`SELECT count(*)::int AS n FROM employees WHERE company_id=${f.company} AND name_en='Worker happy'`;
  expect(counts?.['n']).toBe(1);
  const [audit] = await f.h
    .owner`SELECT actor_user_id FROM audit_log WHERE company_id=${f.company} AND action='imported'`;
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
  const [status] = await f.h
    .owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${id}`;
  expect(status).toMatchObject({
    status: 'failed',
    error_code: 'EMPLOYEE_BRANCH_NOT_FOUND',
    created_count: 0,
  });
  expect(
    await f.h
      .owner`SELECT id FROM employees WHERE company_id=${f.company} AND name_en='Worker rollback'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE company_id=${f.company} AND after->>'name_en'='Worker rollback'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.company} AND payload->>'name_en'='Worker rollback'`,
  ).toHaveLength(0);
});

it('cannot consume a preview from another tenant and refuses expiry under the worker lock', async () => {
  const id = await requested('Worker tenant');
  const otherCompany = await f.h.onboard(f.managerCookie, 'Synthetic other worker tenant');
  await f.worker.execute(otherCompany, id);
  const [unchanged] = await f.h.owner`SELECT status FROM import_previews WHERE id=${id}`;
  expect(unchanged?.['status']).toBe('commit_requested');
  f.clock.value = new Date('2026-10-06T10:00:00Z');
  await f.worker.execute(f.company, id);
  const [failed] = await f.h.owner`SELECT status,error_code FROM import_previews WHERE id=${id}`;
  expect(failed).toMatchObject({ status: 'failed', error_code: 'IMPORT_PREVIEW_EXPIRED' });
});
