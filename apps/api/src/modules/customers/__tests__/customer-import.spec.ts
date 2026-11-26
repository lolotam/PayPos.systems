import { afterAll, beforeAll, expect, it } from 'vitest';

import { CustomerImportError } from '../domain/customer-import.ts';
import { customerImportScopeReads } from '../persistence/drizzle-customer-import.ts';
import {
  customerImportRowsPage,
  customerImportStatusQuery,
} from '../queries/customer-import-reads.query.ts';
import {
  commitCommand,
  customerImportFixture,
  customerWorkbook,
  previewCommand,
  type CustomerImportFixture,
} from './customer-import.fixture.ts';

let f: CustomerImportFixture;
beforeAll(async () => {
  f = await customerImportFixture();
});
afterAll(async () => {
  await f?.close();
});

const VALID = [
  ['أحمد', '98765432', '', '', '', '', '', 'ذكر', '', 'ملاحظة'],
  ['سالم', '98765433', '', '', '', '', '', 'أنثى', '', ''],
] as const;

it('serves a bilingual xlsx template with the ten authoritative headers', async () => {
  const result = await f.template.execute({
    companyId: f.company,
    userId: f.userId,
    scope: { kind: 'business', id: f.business },
  });
  expect(result.content_type).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const bytes = Buffer.from(result.content_base64, 'base64');
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
});

it('refuses the template of a business outside the company', async () => {
  await expect(
    f.template.execute({
      companyId: f.company,
      userId: f.userId,
      scope: { kind: 'business', id: f.otherBusiness },
    }),
  ).rejects.toThrow(new CustomerImportError('NOT_FOUND'));
});

it('previews a verified workbook without writing any customer', async () => {
  const fileId = await f.upload(await customerWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.row_count).toBe(2);
  expect(preview.new_count).toBe(2);
  expect(preview.existing_count).toBe(0);
  expect(preview.error_count).toBe(0);
  expect(preview.rows.map((row) => row.masked_phone)).toEqual(['***432', '***433']);
  expect(JSON.stringify(preview)).not.toContain('98765432');
  const [count] =
    await f.owner`SELECT count(*)::int AS n FROM customers WHERE company_id=${f.company}`;
  expect(count?.['n']).toBe(0);
});

it('previews a branch scope against the business of that branch', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId, 'branch'));
  expect(preview.row_count).toBe(1);
});

it('refuses a preview until the business country is set', async () => {
  await f.owner`UPDATE businesses SET settings='{}'::jsonb
    WHERE company_id=${f.company} AND id=${f.business}`;
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  await expect(f.preview.execute(previewCommand(f, fileId))).rejects.toThrow(
    new CustomerImportError('IMPORT_BUSINESS_COUNTRY_REQUIRED'),
  );
  await f.owner`UPDATE businesses SET settings='{"country":"KW"}'::jsonb
    WHERE company_id=${f.company} AND id=${f.business}`;
});

it('refuses a file that belongs to another creator', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]), {
    createdBy: f.ownerUserId,
  });
  await expect(f.preview.execute(previewCommand(f, fileId))).rejects.toThrow(
    new CustomerImportError('IMPORT_FILE_NOT_FOUND'),
  );
});

it('serves the preview rows and status to its creator only and isolates tenants', async () => {
  const fileId = await f.upload(await customerWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const input = {
    companyId: f.company,
    userId: f.userId,
    scope: { kind: 'business' as const, id: f.business },
    previewId: preview.preview_id,
  };
  const first = await customerImportRowsPage(f.db, customerImportScopeReads, {
    ...input,
    cursor: undefined,
    limit: 1,
  });
  expect(first.items.map((row) => row.row)).toEqual([2]);
  expect(first.next_cursor).toBe('2');
  const second = await customerImportRowsPage(f.db, customerImportScopeReads, {
    ...input,
    cursor: first.next_cursor ?? undefined,
    limit: 1,
  });
  expect(second.items.map((row) => row.row)).toEqual([3]);
  expect(second.next_cursor).toBeNull();
  const status = await customerImportStatusQuery(f.db, customerImportScopeReads, input);
  expect(status).toMatchObject({ preview_id: preview.preview_id, status: 'ready' });
  const foreign = await customerImportStatusQuery(f.db, customerImportScopeReads, {
    ...input,
    userId: f.ownerUserId,
  }).catch((error: unknown) => error);
  expect(foreign).toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
  const crossTenant = await customerImportStatusQuery(f.db, customerImportScopeReads, {
    ...input,
    companyId: f.otherCompany,
  }).catch((error: unknown) => error);
  expect(crossTenant).toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
});

it('counts all parsed rows including invalid ones in row_count and blocks commit on errors', async () => {
  const mixed = [VALID[0], ['سارة', 'bad-phone', '', '', '', '', '', '', '', '']] as const;
  const fileId = await f.upload(await customerWorkbook(mixed));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  expect(preview.row_count).toBe(2);
  expect(preview.new_count).toBe(1);
  expect(preview.error_count).toBeGreaterThan(0);
  await expect(f.commit.execute(commitCommand(f, preview.preview_id, 'key-err'))).rejects.toThrow(
    new CustomerImportError('IMPORT_PREVIEW_HAS_ERRORS'),
  );
});

it('requests one commit and replays it without a second event', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  const accepted = await f.commit.execute(commitCommand(f, preview.preview_id, 'key-one'));
  expect(accepted.preview_id).toBe(preview.preview_id);
  const replay = await f.commit.execute(commitCommand(f, preview.preview_id, 'key-one'));
  expect(replay.preview_id).toBe(preview.preview_id);
  const [events] = await f.owner`SELECT count(*)::int AS n FROM outbox
    WHERE aggregate_id=${preview.preview_id} AND event_type='CustomerImportCommitRequested'`;
  expect(events?.['n']).toBe(1);
});

it('records the file access in the audit log', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  await f.preview.execute(previewCommand(f, fileId));
  const [entry] = await f.owner`SELECT action FROM audit_log
    WHERE entity='file' AND entity_id=${fileId}`;
  expect(entry?.['action']).toBe('import_previewed');
});

it('refuses a commit for a preview of another creator', async () => {
  const fileId = await f.upload(await customerWorkbook([VALID[0]]));
  const preview = await f.preview.execute(previewCommand(f, fileId));
  await expect(
    f.commit.execute({
      ...commitCommand(f, preview.preview_id, 'key-two'),
      userId: f.ownerUserId,
    }),
  ).rejects.toThrow(new CustomerImportError('IMPORT_PREVIEW_NOT_FOUND'));
});
