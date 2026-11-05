import { expect, it } from 'vitest';
import { packagePreviewKey, packagePreviewRefs } from '../package-preview.ts';
import { PACKAGE_IMPORT_CONTENT_TYPE } from '../package-import.ts';

const preview = {
  businessId: 'business', userId: 'requester', expiresAt: '2026-11-06T12:00:00Z',
  file: { business_id: 'business', created_by: 'requester', content_type: PACKAGE_IMPORT_CONTENT_TYPE,
    size_bytes: 100, status: 'READY', storage_key: 'synthetic/key', purged: false, purge_started: false },
};
it('requires live file ownership and rejects expiry at its exact instant', () => {
  expect(packagePreviewKey(preview, new Date('2026-11-06T11:59:59.999Z'))).toBe('synthetic/key');
  expect(() => packagePreviewKey(preview, new Date(preview.expiresAt))).toThrow('IMPORT_FILE_NOT_FOUND');
  expect(() => packagePreviewKey(preview, new Date('2026-11-05'), 'changed/key')).toThrow('IMPORT_FILE_NOT_FOUND');
  expect(() => packagePreviewKey({ ...preview, file: { ...preview.file, created_by: 'other' } }, new Date('2026-11-05'))).toThrow('IMPORT_FILE_NOT_FOUND');
});
it('collects bounded external references without swallowing invalid values for validation', () => {
  expect(packagePreviewRefs([{ cells: [null, null, null, null, null, ' synthetic '] }, { cells: [] }, { cells: [null, null, null, null, null, 'x'.repeat(101)] }])).toEqual(['synthetic']);
});
