import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { runIdempotent } from '@pospay/db';

import { EmployeeImportError } from '../domain/employee-import.ts';
import {
  commitCommand,
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
  seedImportPlanRows,
  type EmployeeImportFixture,
} from './employee-import.fixture.ts';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.h.close();
});

const VALID = [
  ['Employee One', null, 'staff', '2026-01-01', null, 'Main'],
  ['Employee Two', 'موظف', 'cashier', 45000, '2099-01-01', 'main'],
] as const;

const employeeCount = () =>
  f.h.owner`SELECT count(*)::int AS n FROM employees WHERE company_id=${f.company}`;

const rejected = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EmployeeImportError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
};

it('serves a bilingual xlsx template with the authoritative headers', async () => {
  const result = await f.template.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
  });
  expect(result.content_type).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const bytes = Buffer.from(result.content_base64, 'base64');
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

it('previews a valid workbook without writing any employee, then commits all rows in one transaction', async () => {
  const fileId = await f.upload(await employeeWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.row_count).toBe(2);
  expect(preview.error_count).toBe(0);
  expect(preview.errors).toEqual([]);
  expect(await employeeCount()).toEqual([{ n: 0 }]);

  const accepted = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-key-1'));
  expect(accepted).toEqual({ preview_id: preview.preview_id });
  expect(await employeeCount()).toEqual([{ n: 0 }]);
  await f.worker.execute(f.company, preview.preview_id);
  expect(await employeeCount()).toEqual([{ n: 2 }]);
  expect(
    await f.h.owner`SELECT count(*)::int AS n FROM employee_branches WHERE company_id=${f.company}`,
  ).toEqual([{ n: 2 }]);
  const imported = await f.h.owner`SELECT event_type FROM outbox WHERE company_id=${f.company}
    ORDER BY seq`;
  expect(imported.map((row) => row['event_type'])).toContain('ImportCommitted');
  expect(imported.filter((row) => row['event_type'] === 'EmployeeImported')).toHaveLength(2);
  expect(
    await f.h.owner`SELECT count(*)::int AS n FROM audit_log
      WHERE company_id=${f.company} AND entity='employee' AND action='imported'`,
  ).toEqual([{ n: 2 }]);
});

it('replays a key and a second request for the same preview without creating another job', async () => {
  const fileId = await f.upload(await employeeWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const first = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-idem'));
  const replay = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-idem'));
  expect(replay).toEqual(first);
  expect(await f.commit.execute(commitCommand(f, preview.preview_id, 'import-second'))).toEqual(
    first,
  );
  await f.worker.execute(f.company, preview.preview_id);
  expect((await employeeCount())[0]?.['n']).toBe(3);
  const [jobs] = await f.h.owner`SELECT count(*)::int AS n FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${preview.preview_id} AND event_type='EmployeeImportCommitRequested'`;
  expect(jobs?.['n']).toBe(1);
});

it('serialises concurrent requests and worker retries into one employee', async () => {
  const fileId = await f.upload(
    await employeeWorkbook([['Concurrent', null, 'staff', '2026-01-01', null, 'main']]),
  );
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const results = await Promise.allSettled([
    f.commit.execute(commitCommand(f, preview.preview_id, 'concurrent-a')),
    f.commit.execute(commitCommand(f, preview.preview_id, 'concurrent-b')),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
  await Promise.all([
    f.worker.execute(f.company, preview.preview_id),
    f.worker.execute(f.company, preview.preview_id),
  ]);
  expect(
    await f.h
      .owner`SELECT count(*)::int AS n FROM employees WHERE company_id=${f.company} AND name_en='Concurrent'`,
  ).toEqual([{ n: 1 }]);
});

it('an invalid row writes nothing and the preview cannot be committed', async () => {
  const fileId = await f.upload(
    await employeeWorkbook([
      ['Valid row', null, 'staff', '2026-01-01', null, 'Main'],
      ['Invalid row', null, 'staff', '2026-01-01', null, 'Nowhere'],
    ]),
  );
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.error_count).toBe(1);
  expect(preview.errors).toEqual([
    { row: 3, column: 'primary_branch', code: 'IMPORT_BRANCH_NOT_FOUND' },
  ]);
  expect((await employeeCount())[0]?.['n']).toBe(4);
  expect(
    await rejected(f.commit.execute(commitCommand(f, preview.preview_id, 'invalid-rows'))),
  ).toBe('IMPORT_PREVIEW_HAS_ERRORS');
  expect((await employeeCount())[0]?.['n']).toBe(4);
});

it('refuses an expired preview and a file of another business', async () => {
  const fileId = await f.upload(await employeeWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  await f.h
    .owner`UPDATE import_previews SET created_at='2000-01-01T00:00:00Z', expires_at='2000-01-02T00:00:00Z' WHERE id=${preview.preview_id}`;
  expect(await rejected(f.commit.execute(commitCommand(f, preview.preview_id, 'expired')))).toBe(
    'IMPORT_PREVIEW_EXPIRED',
  );

  const foreign = await f.upload(await employeeWorkbook(VALID), { businessId: f.secondBusiness });
  expect(await rejected(f.preview.execute(previewCommand(f, foreign)))).toBe(
    'IMPORT_FILE_NOT_FOUND',
  );
});

it('fails the whole commit when a branch is no longer in the business', async () => {
  const branch2 = systemUuidV7().newId();
  await f.h
    .owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${f.company},${branch2},${f.business},'Main2')`;
  const fileId = await f.upload(
    await employeeWorkbook([['Moved branch', null, 'staff', '2026-01-01', null, 'Main2']]),
  );
  const preview = await f.preview.execute(previewCommand(f, fileId));
  await f.h.owner`DELETE FROM branches WHERE company_id=${f.company} AND id=${branch2}`;
  await f.commit.execute(commitCommand(f, preview.preview_id, 'moved-branch'));
  await f.worker.execute(f.company, preview.preview_id);
  const [result] = await f.h
    .owner`SELECT status,error_code FROM import_previews WHERE id=${preview.preview_id}`;
  expect(result).toMatchObject({ status: 'failed', error_code: 'EMPLOYEE_BRANCH_NOT_FOUND' });
});

it('uses the preview primary key for its lookup', async () => {
  await seedImportPlanRows(f);
  const plan = await f.h
    .owner`EXPLAIN ANALYZE SELECT id,business_id,created_by,status,committed_at,expires_at,rows,errors
    FROM import_previews WHERE company_id=${f.company} AND id=${'00000000-0000-7000-8000-000000000000'} AND entity='employees' FOR UPDATE`;
  expect(plan.map((row) => String(row['QUERY PLAN'])).join('\n')).toMatch(/import_previews_pkey/);
});

it('accepts 500 rows in a warm API call under 200 ms and the worker commits every row', async () => {
  const file = await f.upload(
    await employeeWorkbook(
      Array.from({ length: 500 }, (_, index) => [
        `Synthetic batch ${index}`,
        null,
        'staff',
        '2026-01-01',
        null,
        'Main',
      ]),
    ),
  );
  const preview = await f.preview.execute(previewCommand(f, file));
  expect(preview.error_count).toBe(0);
  const warm = await f.preview.execute(
    previewCommand(f, await f.upload(await employeeWorkbook([VALID[0]]))),
  );
  await f.commit.execute(commitCommand(f, warm.preview_id, 'batch-warm'));
  const start = performance.now();
  const accepted = await f.commit.execute(commitCommand(f, preview.preview_id, 'batch-500'));
  const elapsed = performance.now() - start;
  console.info('EMPLOYEE_IMPORT_500_COMMIT_MS', { milliseconds: Number(elapsed.toFixed(2)) });
  expect(elapsed).toBeLessThan(200);
  expect(accepted.preview_id).toBe(preview.preview_id);
  await f.worker.execute(f.company, preview.preview_id);
  const [summaryResult] = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company}
    AND aggregate_id=${preview.preview_id} AND event_type='ImportCommitted'`;
  const result = summaryResult?.['payload'] as { created_count: number; employee_ids: string[] };
  expect(result.created_count).toBe(500);
  const [counts] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM audit_log WHERE company_id=${f.company} AND entity_id=ANY(${result.employee_ids}::uuid[])) AS audits,
    (SELECT count(*)::int FROM outbox WHERE company_id=${f.company} AND aggregate_id=ANY(${result.employee_ids}::uuid[])) AS events`;
  expect(counts).toMatchObject({ audits: 500, events: 500 });
  const [summary] = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company}
    AND aggregate_id=${preview.preview_id} AND event_type='ImportCommitted'`;
  expect(summary?.['payload'].committed_at).toBe(f.clock.value.toISOString());
  const [employee] = await f.h
    .owner`SELECT created_at FROM employees WHERE company_id=${f.company} AND id=${result.employee_ids[0] as string}`;
  expect(new Date(employee?.['created_at']).toISOString()).toBe(f.clock.value.toISOString());
});

it('normalizes a legacy synchronous idempotency replay to the new acceptance contract', async () => {
  const preview = await f.preview.execute(
    previewCommand(f, await f.upload(await employeeWorkbook([VALID[0]]))),
  );
  await f.h.owner`UPDATE import_previews SET status='committed',created_count=1,
    committed_at=${f.clock.value.toISOString()} WHERE id=${preview.preview_id}`;
  const command = commitCommand(f, preview.preview_id, 'legacy-commit');
  await f.db.withTenant(
    f.company,
    (tx) =>
      runIdempotent(
        tx,
        {
          scope: 'COMPANY',
          operation: 'import-employees',
          key: command.key,
          fingerprint: command.fingerprint,
        },
        async () => ({
          status: 201,
          body: { preview_id: preview.preview_id, created_count: 1, employee_ids: [] },
        }),
      ),
    { userId: f.userId },
  );
  expect(await f.commit.execute(command)).toEqual({ preview_id: preview.preview_id });
  expect(
    await f.h.owner`SELECT id FROM outbox WHERE aggregate_id=${preview.preview_id}
    AND event_type='EmployeeImportCommitRequested'`,
  ).toHaveLength(0);
});
