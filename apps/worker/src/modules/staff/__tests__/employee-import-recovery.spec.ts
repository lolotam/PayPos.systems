import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { employeeImportFixture, type EmployeeImportFixture } from './employee-import.fixture.ts';
import {
  employeeImportRecoveryTransactions,
  importRecoveryCandidates,
} from '../persistence/employee-import-recovery.transactions.ts';
import { RecoverEmployeeImports } from '../use-cases/recover-employee-imports/recover-employee-imports.ts';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.close();
});

it('fails a ten-minute-old request with no job, preserves recent requests, and cannot sweep another tenant', async () => {
  const old = await f.requested('Lost job', { requestedAt: new Date('2026-10-05T09:50:00Z') });
  const recent = await f.requested('Recent job', {
    requestedAt: new Date('2026-10-05T09:50:00.001Z'),
  });
  const sweep = new RecoverEmployeeImports(employeeImportRecoveryTransactions(f.db), {
    now: () => f.clock.value,
  });
  await sweep.execute(f.otherCompany);
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${old}`)[0]?.['status']).toBe(
    'commit_requested',
  );
  await sweep.execute(f.company);
  expect(
    (await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${old}`)[0],
  ).toMatchObject({
    status: 'failed',
    error_code: 'IMPORT_COMMIT_FAILED',
    created_count: 0,
  });
  expect(
    (await f.owner`SELECT status FROM import_previews WHERE id=${recent}`)[0]?.['status'],
  ).toBe('commit_requested');
  await f.worker.execute(f.company, old);
  expect(await f.owner`SELECT id FROM employees WHERE name_en='Lost job'`).toHaveLength(0);
});

it('does not overwrite a worker commit that wins between candidate read and conditional failure', async () => {
  const id = await f.requested('Sweep race', { requestedAt: new Date('2026-10-05T09:45:00Z') });
  const transactions = employeeImportRecoveryTransactions(f.db);
  let raced = false;
  const sweep = new RecoverEmployeeImports(
    {
      ...transactions,
      candidates: async (...args) => {
        const candidates = await transactions.candidates(...args);
        if (!raced) {
          expect(candidates).toContain(id);
          await f.worker.execute(f.company, id);
          raced = true;
        }
        return candidates;
      },
    },
    { now: () => f.clock.value },
  );
  await sweep.execute(f.company);
  expect(
    (await f.owner`SELECT status,error_code,created_count FROM import_previews WHERE id=${id}`)[0],
  ).toMatchObject({
    status: 'committed',
    error_code: null,
    created_count: 1,
  });
});

it('uses the tenant/status/request index for the actual bounded sweep query', async () => {
  const id = await f.requested('Plan');
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
    status,requested_at,row_count,error_count,rows,errors)
    SELECT company_id,gen_random_uuid(),business_id,entity,file_id,created_by,created_at,expires_at,status,requested_at,
      row_count,error_count,rows,errors FROM import_previews CROSS JOIN generate_series(1,500) WHERE id=${id}`;
  await f.owner`ANALYZE import_previews`;
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`EXPLAIN ANALYZE ${importRecoveryCandidates(f.company, new Date('2000-01-01'))}`),
  );
  expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
    'import_previews_company_status_requested_idx',
  );
});

it('drains multiple bounded pages so a stale backlog does not extend recovery by another cadence', async () => {
  const id = await f.requested('Stale backlog', { requestedAt: new Date('2026-10-05T09:40:00Z') });
  await f.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,
    status,requested_at,row_count,error_count,rows,errors)
    SELECT company_id,gen_random_uuid(),business_id,entity,file_id,created_by,created_at,expires_at,status,requested_at,
      row_count,error_count,rows,errors FROM import_previews CROSS JOIN generate_series(1,60) WHERE id=${id}`;
  await new RecoverEmployeeImports(employeeImportRecoveryTransactions(f.db), {
    now: () => f.clock.value,
  }).execute(f.company);
  const [remaining] = await f.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE status='commit_requested' AND requested_at<='2026-10-05T09:50:00Z'`;
  expect(remaining?.['n']).toBe(0);
  const [failed] = await f.owner`SELECT count(*)::int AS n FROM import_previews
    WHERE rows->0->>'name_en'='Stale backlog' AND status='failed' AND error_code='IMPORT_COMMIT_FAILED'`;
  expect(failed?.['n']).toBe(61);
});

it.each([
  "status='committed'",
  'committed_at=now()',
  "status='failed',error_code=NULL",
  'created_count=1',
])('rejects inconsistent state: %s', async (assignment) => {
  const id = await f.requested('Constraint');
  await expect(
    f.owner.unsafe(`UPDATE import_previews SET ${assignment} WHERE id=$1`, [id]),
  ).rejects.toMatchObject({ code: '23514' });
});
