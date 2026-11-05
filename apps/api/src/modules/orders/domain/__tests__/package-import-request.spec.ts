import { expect, it } from 'vitest';
import {
  pendingPackagePreview,
  requirePackageImportFile,
  type PackageImportFileFacts,
} from '../package-import-request.ts';

const actor = { companyId: 'company', userId: 'user', businessId: 'business' };
const facts: PackageImportFileFacts = {
  business_id: 'business',
  created_by: 'user',
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 2097152,
  status: 'READY',
  storage_key: 'verified/key',
  purged: false,
  purge_started: false,
};
it('accepts maximum-size READY facts and derives the same 24-hour preview expiry', () => {
  expect(() => requirePackageImportFile(facts, actor)).not.toThrow();
  expect(pendingPackagePreview('preview', 'file', new Date('2026-11-05T10:00:00Z'))).toEqual({
    id: 'preview',
    fileId: 'file',
    createdAt: '2026-11-05T10:00:00.000Z',
    expiresAt: '2026-11-06T10:00:00.000Z',
  });
});
it.each([
  [null, 'IMPORT_FILE_NOT_FOUND'],
  [{ ...facts, business_id: 'other' }, 'IMPORT_FILE_NOT_FOUND'],
  [{ ...facts, created_by: 'other' }, 'IMPORT_FILE_NOT_FOUND'],
  [{ ...facts, purged: true }, 'IMPORT_FILE_NOT_FOUND'],
  [{ ...facts, purge_started: true }, 'IMPORT_FILE_NOT_FOUND'],
  [{ ...facts, status: 'PENDING' }, 'IMPORT_FILE_NOT_READY'],
  [{ ...facts, storage_key: null }, 'IMPORT_FILE_NOT_READY'],
  [{ ...facts, content_type: 'application/pdf' }, 'IMPORT_FILE_TYPE_INVALID'],
  [{ ...facts, size_bytes: 0 }, 'IMPORT_FILE_SIZE_INVALID'],
  [{ ...facts, size_bytes: 2097153 }, 'IMPORT_FILE_SIZE_INVALID'],
] as const)('rejects unsafe facts without reading bytes (%s)', (file, code) => {
  expect(() => requirePackageImportFile(file, actor)).toThrow(code);
});
