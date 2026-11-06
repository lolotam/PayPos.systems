import { afterAll, beforeAll, expect, it } from 'vitest';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { sql } from 'drizzle-orm';
import { ExecutePackagePreview } from '../use-cases/execute-package-preview/execute-package-preview.ts';
import { packagePreviewTransactions } from '../persistence/package-preview.transactions.ts';
import { packagePreviewWorkbook } from '../persistence/package-preview-workbook.ts';
import {
  packagePreviewFixture,
  packageWorkbook,
  editPackageWorkbook,
  type PackagePreviewFixture,
} from './package-preview.fixture.ts';

let f: PackagePreviewFixture;
let bytes: Uint8Array;
let membership: string;
beforeAll(async () => {
  f = await packagePreviewFixture();
  membership = f.ids.newId();
  const [role] = await f.owner`SELECT id FROM roles WHERE company_id IS NULL AND code='owner'`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${f.company},${membership},${USER},${role?.['id']},'global','COMPANY',${f.company})`;
  bytes = await packageWorkbook(1, 2, 'partition');
});
afterAll(async () => {
  await f?.close();
});

interface Result {
  source: string | null;
  skipped: string | null;
  rows: string;
  errors: string;
  rowCount: number;
  errorCount: number;
  skippedCount: number;
}

const result: Result = {
  source: '[2,4,6]',
  skipped: '[6]',
  rows: '[{"row":2}]',
  errors:
    '[{"row":4,"column":"name_en","code":"IMPORT_NAME_INVALID"},{"row":4,"column":"price_paid","code":"INVALID_PRICE"}]',
  rowCount: 3,
  errorCount: 2,
  skippedCount: 1,
};
function ready(id: string, changes: Partial<Result> = {}) {
  const r = { ...result, ...changes };
  return f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`UPDATE import_previews
    SET status='ready',row_count=${r.rowCount},error_count=${r.errorCount},skipped_count=${r.skippedCount},
    source_rows=${r.source}::jsonb,skipped_rows=${r.skipped}::jsonb,
    rows=${r.rows}::jsonb,errors=${r.errors}::jsonb WHERE id=${id}`),
  );
}

it.each<[string, Partial<Result>]>([
  ['omitted source proof', { source: null }],
  ['omitted skipped proof', { skipped: null }],
  ['omitted source row', { source: '[2,4]' }],
  ['foreign source row', { source: '[2,4,7]' }],
  ['duplicate source row', { source: '[2,2,4]' }],
  ['foreign valid row', { rows: '[{"row":3}]' }],
  ['foreign invalid row', { errors: '[{"row":3},{"row":3}]' }],
  ['foreign skipped row', { skipped: '[7]' }],
  ['skipped overlaps valid', { skipped: '[2]' }],
  ['skipped overlaps invalid', { skipped: '[4]' }],
  [
    'duplicate skipped row',
    { source: '[2,4,6,8]', skipped: '[6,6]', rowCount: 4, skippedCount: 2 },
  ],
  ['duplicate valid row', { rows: '[{"row":2},{"row":2}]', source: '[2,3,4,6]', rowCount: 4 }],
  ['valid overlaps invalid', { rows: '[{"row":4}]' }],
  ['wrong skipped count', { skipped: '[]' }],
  ['object source', { source: '{}' }],
  ['scalar source', { source: '2' }],
  ['JSON null source', { source: 'null' }],
  ['object skipped', { skipped: '{}' }],
  ['scalar skipped', { skipped: '6' }],
  ['JSON null skipped', { skipped: 'null' }],
  ['string source ordinal', { source: '["2",4,6]' }],
  ['null source ordinal', { source: '[null,4,6]' }],
  ['object source ordinal', { source: '[{},4,6]' }],
  ['nested source ordinal', { source: '[[2],4,6]' }],
  ['boolean source ordinal', { source: '[true,4,6]' }],
  ['fraction source ordinal', { source: '[2.5,4,6]' }],
  ['numeric alias source ordinal', { source: '[2.0,4,6]' }],
  ['negative source ordinal', { source: '[-2,4,6]' }],
  ['header source ordinal', { source: '[1,4,6]' }],
  ['out-of-bound source ordinal', { source: '[503,4,6]' }],
  ['huge source ordinal', { source: '[99999999999999999999,4,6]' }],
  ['string skipped ordinal', { skipped: '["6"]' }],
  ['null skipped ordinal', { skipped: '[null]' }],
  ['fraction skipped ordinal', { skipped: '[6.5]' }],
  ['numeric alias skipped ordinal', { skipped: '[6.0]' }],
  ['numeric alias valid ordinal', { rows: '[{"row":2.0}]' }],
  ['numeric alias invalid ordinal', { errors: '[{"row":4.0},{"row":4}]' }],
])('refuses %s without leaving pending', async (_name, changes) => {
  const { id } = await f.requested(bytes);
  await expect(ready(id, changes)).rejects.toMatchObject({
    cause: { code: '23514', message: 'IMPORT_PREVIEW_READY_RESULTS_INVALID' },
  });
  expect(
    (await f.owner`SELECT status,source_rows,skipped_rows FROM import_previews WHERE id=${id}`)[0],
  ).toEqual({ status: 'pending', source_rows: null, skipped_rows: null });
});

it('accepts exact non-contiguous coverage with several errors on one row and freezes both proof columns', async () => {
  const { id } = await f.requested(bytes);
  await ready(id, { source: '[6,2,4]' });
  const [original] =
    await f.owner`SELECT status,row_count,error_count,skipped_count,source_rows,skipped_rows,rows,errors
    FROM import_previews WHERE id=${id}`;
  expect(original).toMatchObject({
    status: 'ready',
    row_count: 3,
    error_count: 2,
    skipped_count: 1,
    source_rows: [6, 2, 4],
    skipped_rows: [6],
  });
  for (const change of [
    sql`source_rows='[2,4,7]'::jsonb`,
    sql`skipped_rows='[7]'::jsonb`,
    sql`source_rows=NULL,skipped_rows=NULL`,
  ]) {
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`UPDATE import_previews SET ${change} WHERE id=${id}`),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'IMPORT_PREVIEW_TRANSITION_INVALID' },
    });
  }
  expect(
    (
      await f.owner`SELECT status,row_count,error_count,skipped_count,source_rows,skipped_rows,rows,errors
    FROM import_previews WHERE id=${id}`
    )[0],
  ).toEqual(original);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at=now(),commit_membership_id=${membership} WHERE id=${id}`),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'IMPORT_PREVIEW_TRANSITION_INVALID' },
  });
  expect((await f.owner`SELECT status FROM import_previews WHERE id=${id}`)[0]?.['status']).toBe(
    'ready',
  );
});

it('permits empty ready results only with an explicit empty proof', async () => {
  const { id } = await f.requested(bytes);
  await ready(id, {
    source: '[]',
    skipped: '[]',
    rows: '[]',
    errors: '[]',
    rowCount: 0,
    errorCount: 0,
    skippedCount: 0,
  });
  expect(
    (await f.owner`SELECT status,source_rows,skipped_rows FROM import_previews WHERE id=${id}`)[0],
  ).toEqual({ status: 'ready', source_rows: [], skipped_rows: [] });
});

it('refuses proof writes before ready, during failure, and at insert', async () => {
  const { id } = await f.requested(bytes);
  for (const change of [
    sql`source_rows='[]'::jsonb,skipped_rows='[]'::jsonb`,
    sql`status='failed',error_code='STORAGE_UNAVAILABLE',source_rows='[]'::jsonb,skipped_rows='[]'::jsonb`,
  ]) {
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`UPDATE import_previews SET ${change} WHERE id=${id}`),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', message: 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' },
    });
  }
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors,source_rows,skipped_rows)
    SELECT company_id,${f.ids.newId()},business_id,entity,file_id,created_by,created_at,expires_at,0,0,'[]','[]','[]','[]'
    FROM import_previews WHERE id=${id}`),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' },
  });
});

it('refuses the old NULL-proof writer after contract; rollback floor is 47-2a', async () => {
  const { id } = await f.requested(bytes);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews SET status='ready',row_count=3,error_count=2,skipped_count=1,
      rows='[{"row":2}]'::jsonb,errors='[{"row":4},{"row":4}]'::jsonb WHERE id=${id}`),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'IMPORT_PREVIEW_READY_RESULTS_INVALID' },
  });
  expect(
    (await f.owner`SELECT status,source_rows,skipped_rows FROM import_previews WHERE id=${id}`)[0],
  ).toEqual({ status: 'pending', source_rows: null, skipped_rows: null });
});

it('leaves legacy ready rows readable but refuses commit under PP-134', async () => {
  const { id } = await f.requested(bytes);
  const legacy = f.ids.newId();
  await f.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    SELECT company_id,${legacy},business_id,entity,file_id,created_by,created_at,expires_at,1,0,'[{"row":2}]','[]'
    FROM import_previews WHERE id=${id}`;
  const before = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT status,source_rows,skipped_rows
    FROM import_previews WHERE id=${legacy}`),
  );
  expect(Array.from(before)).toEqual([{ status: 'ready', source_rows: null, skipped_rows: null }]);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at=now(),commit_membership_id=${membership} WHERE id=${legacy}`),
    ),
  ).rejects.toMatchObject({ cause: { code: '23514', message: 'IMPORT_PREVIEW_EXPIRED' } });
  expect(
    await f.owner`SELECT status,source_rows,skipped_rows FROM import_previews WHERE id=${legacy}`,
  ).toEqual([{ status: 'ready', source_rows: null, skipped_rows: null }]);
});

it('isolates proof reads and writes by tenant and grants no extra runtime role access', async () => {
  const { id } = await f.requested(bytes);
  await ready(id);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT source_rows,skipped_rows
    FROM import_previews WHERE company_id=${f.company} AND id=${id}`),
    ),
  ).toHaveLength(0);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET source_rows=NULL,skipped_rows=NULL WHERE company_id=${f.company} AND id=${id} RETURNING id`),
    ),
  ).toHaveLength(0);
  expect(
    (await f.owner`SELECT source_rows,skipped_rows FROM import_previews WHERE id=${id}`)[0],
  ).toEqual({ source_rows: [2, 4, 6], skipped_rows: [6] });
  const [privileges] = await f.owner`SELECT
    has_column_privilege('pospay_app','import_previews','source_rows','UPDATE') AS source,
    has_column_privilege('pospay_app','import_previews','skipped_rows','UPDATE') AS skipped,
    has_table_privilege('pospay_app','import_previews','UPDATE') AS table_update,
    has_function_privilege('pospay_app','package_import_preview_partition_guard()','EXECUTE') AS app,
    has_function_privilege('pospay_auth','package_import_preview_partition_guard()','EXECUTE') AS auth,
    has_function_privilege('pospay_dispatcher','package_import_preview_partition_guard()','EXECUTE') AS dispatcher,
    (SELECT count(*)::int FROM pg_proc p,aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid='package_import_preview_partition_guard()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS public_grants`;
  expect(privileges).toEqual({
    source: true,
    skipped: true,
    table_update: false,
    app: true,
    auth: false,
    dispatcher: false,
    public_grants: 0,
  });
});

it('keeps staff legacy proof NULL and its ready-to-commit_requested transition unchanged', async () => {
  const { id } = await f.requested(bytes);
  const staff = f.ids.newId();
  await f.owner`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    SELECT company_id,${staff},business_id,'employees',file_id,created_by,created_at,expires_at,0,0,'[]','[]'
    FROM import_previews WHERE id=${id}`;
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE import_previews
    SET source_rows='[]'::jsonb,skipped_rows='[]'::jsonb WHERE id=${staff}`),
    ),
  ).rejects.toMatchObject({
    cause: { code: '23514', message: 'IMPORT_PREVIEW_RESULTS_IMMUTABLE' },
  });
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`UPDATE import_previews
    SET status='commit_requested',requested_at=now() WHERE id=${staff}`),
  );
  expect(
    (
      await f.owner`SELECT status,source_rows,skipped_rows FROM import_previews WHERE id=${staff}`
    )[0],
  ).toEqual({ status: 'commit_requested', source_rows: null, skipped_rows: null });
});

it('persists the physical mixed partition through ExecutePackagePreview without counting blank rows', async () => {
  const content = await editPackageWorkbook(await packageWorkbook(4, 2, 'mixed'), (sheet) => {
    sheet.getRow(3).values = [];
    sheet.getCell('A4').value = 'invalid';
    sheet.getCell('B4').value = null;
    sheet.getCell('H4').value = null;
    sheet.getCell('I4').value = null;
  });
  const { id } = await f.requested(content);
  const transactions = packagePreviewTransactions(f.database);
  const worker = new ExecutePackagePreview(
    {
      ...transactions,
      finish: (company, preview, work) =>
        transactions.finish(company, preview, (scope) =>
          work({
            ...scope,
            existingRefs: async () => ['mixed-3'],
          }),
        ),
    },
    packagePreviewWorkbook(f.readBytes),
    f.clock,
  );
  await worker.execute(f.company, id);
  const [stored] =
    await f.owner`SELECT status,row_count,skipped_count,source_rows,skipped_rows,rows,errors
    FROM import_previews WHERE id=${id}`;
  expect(stored).toMatchObject({
    status: 'ready',
    row_count: 3,
    skipped_count: 1,
    source_rows: [2, 4, 5],
    skipped_rows: [5],
  });
  expect((stored?.['rows'] as { row: number }[]).map(({ row }) => row)).toEqual([2]);
  expect(stored?.['errors']).toEqual(
    expect.arrayContaining([
      { row: 4, column: 'customer_phone', code: 'IMPORT_PHONE_INVALID' },
      { row: 4, column: 'name_en', code: 'IMPORT_NAME_INVALID' },
      { row: 4, column: 'sessions_1', code: 'IMPORT_REQUIRED_CELL' },
      { row: 4, column: 'remaining_1', code: 'IMPORT_REQUIRED_CELL' },
    ]),
  );
  await worker.execute(f.company, id);
  expect(
    (await f.owner`SELECT source_rows,skipped_rows FROM import_previews WHERE id=${id}`)[0],
  ).toEqual({ source_rows: [2, 4, 5], skipped_rows: [5] });
});
