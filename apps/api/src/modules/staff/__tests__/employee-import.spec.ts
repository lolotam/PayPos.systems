import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import { EmployeeImportError } from '../domain/employee-import.ts';
import {
  commitCommand,
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
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

  const commit = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-key-1'));
  expect(commit.created_count).toBe(2);
  expect(commit.employee_ids).toHaveLength(2);
  expect(await employeeCount()).toEqual([{ n: 2 }]);
  expect(
    await f.h
      .owner`SELECT count(*)::int AS n FROM employee_branches WHERE company_id=${f.company}`,
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

it('is idempotent for a repeated commit key and refuses a second commit of the same preview', async () => {
  const fileId = await f.upload(await employeeWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const first = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-idem'));
  const replay = await f.commit.execute(commitCommand(f, preview.preview_id, 'import-idem'));
  expect(replay).toEqual(first);
  expect((await employeeCount())[0]?.['n']).toBe(3);
  expect(await rejected(f.commit.execute(commitCommand(f, preview.preview_id, 'import-second')))).toBe(
    'IMPORT_PREVIEW_USED',
  );
});

it('serialises two concurrent commits: one wins and one sees the preview used', async () => {
  const fileId = await f.upload(await employeeWorkbook([['Concurrent', null, 'staff', '2026-01-01', null, 'main']]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const results = await Promise.allSettled([
    f.commit.execute(commitCommand(f, preview.preview_id, 'concurrent-a')),
    f.commit.execute(commitCommand(f, preview.preview_id, 'concurrent-b')),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((result) => result.status === 'rejected');
  expect(
    failure?.status === 'rejected' && failure.reason instanceof EmployeeImportError
      ? failure.reason.code
      : null,
  ).toBe('IMPORT_PREVIEW_USED');
  expect(
    await f.h.owner`SELECT count(*)::int AS n FROM employees WHERE company_id=${f.company} AND name_en='Concurrent'`,
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
  await f.h.owner`UPDATE import_previews SET created_at='2000-01-01T00:00:00Z', expires_at='2000-01-02T00:00:00Z' WHERE id=${preview.preview_id}`;
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
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en) VALUES (${f.company},${branch2},${f.business},'Main2')`;
  const fileId = await f.upload(
    await employeeWorkbook([['Moved branch', null, 'staff', '2026-01-01', null, 'Main2']]),
  );
  const preview = await f.preview.execute(previewCommand(f, fileId));
  await f.h.owner`DELETE FROM branches WHERE company_id=${f.company} AND id=${branch2}`;
  expect(
    await rejected(f.commit.execute(commitCommand(f, preview.preview_id, 'moved-branch'))),
  ).toBe('EMPLOYEE_BRANCH_NOT_FOUND');
});

it('uses the preview primary key for its lookup', async () => {
  const plan = await f.h.owner`EXPLAIN SELECT id FROM import_previews WHERE company_id=${f.company} AND id=${'00000000-0000-7000-8000-000000000000'}`;
  expect(plan.map((row) => String(row['QUERY PLAN'])).join('\n')).toMatch(/import_previews_pkey/);
});
