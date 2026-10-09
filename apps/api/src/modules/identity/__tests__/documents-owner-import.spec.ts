import { afterAll, beforeAll, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { employeeImportTemplate } from '@pospay/contracts';
import {
  documentsOwnerFixture,
  documentActor,
  documentRequest,
  requestUpload,
  readyUpload,
  grantDocumentPermission,
  closeDocumentFixture,
  type DocumentsOwnerFixture,
  type DocumentActor,
} from './documents-owner-default.fixture.ts';

let f: DocumentsOwnerFixture, general: DocumentActor;
let workbook: Buffer<ArrayBuffer>;
let contentType: string;
beforeAll(async () => {
  f = await documentsOwnerFixture();
  general = await documentActor(f, 'general_manager');
  await f.h
    .owner`UPDATE branches SET name_en='Import main' WHERE company_id=${f.company} AND id=${f.branch}`;
  const template = await documentRequest(
    f,
    f.cookie,
    'GET',
    `/v1/businesses/${f.business}/employees/import/template`,
  );
  expect(template.status).toBe(200);
  const parsed = employeeImportTemplate.parse(template.body);
  contentType = parsed.content_type;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Uint8Array.from(Buffer.from(parsed.content_base64, 'base64')).buffer);
  const sheet = book.worksheets[0];
  if (sheet === undefined) throw new Error('Synthetic import worksheet missing');
  sheet.getRow(2).values = [
    'Synthetic imported employee',
    null,
    'staff',
    '2026-01-01',
    null,
    'Import main',
  ];
  workbook = Buffer.from(await book.xlsx.writeBuffer());
});
afterAll(() => closeDocumentFixture(f));

async function previewAndCommit(cookie: string) {
  const file = await readyUpload(f, cookie, workbook, contentType);
  const path = `/v1/businesses/${f.business}/employees/import`;
  const preview = await documentRequest(f, cookie, 'POST', `${path}/previews`, { file_id: file });
  expect(preview.status).toBe(201);
  expect(preview.body).toMatchObject({ row_count: 1, error_count: 0 });
  const committed = await documentRequest(f, cookie, 'POST', `${path}/commits`, {
    preview_id: preview.body['preview_id'],
  });
  expect(committed.status).toBe(202);
  const [saved] = await f.h.owner`SELECT status FROM import_previews
    WHERE company_id=${f.company} AND id=${preview.body['preview_id'] as string}`;
  expect(saved?.['status']).toBe('commit_requested');
}
it('ODOC-08: default GM cannot upload the import xlsx; owner uploads, previews and requests commit', async () => {
  expect((await requestUpload(f, general.cookie, workbook, contentType)).status).toBe(403);
  await previewAndCommit(f.cookie);
});
it('ODOC-08: owner-granted read and manage files enable GM upload, preview and commit', async () => {
  await grantDocumentPermission(f, general.membership, 'read:files:business');
  expect((await requestUpload(f, general.cookie, workbook, contentType)).status).toBe(403);
  await grantDocumentPermission(f, general.membership, 'manage:files:business');
  await previewAndCommit(general.cookie);
});
