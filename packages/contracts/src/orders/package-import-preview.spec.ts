import { expect, it } from 'vitest';
import {
  packageImportPreviewAccepted,
  packageImportPreviewRequested,
  packageImportPreviewStatus,
  requestPackageImportPreviewInput,
} from './package-import-preview.js';

const id = '00000000-0000-7000-8000-000000000001';
it('keeps requests/events id-only and models pending, ready and failed responses separately', () => {
  expect(requestPackageImportPreviewInput.parse({ file_id: id })).toEqual({ file_id: id });
  expect(requestPackageImportPreviewInput.safeParse({ file_id: id, company_id: id }).success).toBe(
    false,
  );
  expect(
    packageImportPreviewRequested.safeParse({ preview_id: id, phone: '+99912345678' }).success,
  ).toBe(false);
  expect(packageImportPreviewAccepted.parse({ preview_id: id })).toEqual({ preview_id: id });
  expect(packageImportPreviewStatus.parse({ preview_id: id, status: 'pending' })).toEqual({
    preview_id: id,
    status: 'pending',
  });
  expect(packageImportPreviewStatus.safeParse({ preview_id: id, status: 'failed' }).success).toBe(
    false,
  );
  expect(
    packageImportPreviewStatus.safeParse({
      preview_id: id,
      status: 'ready',
      row_count: 501,
      skipped_count: 0,
      error_count: 0,
      errors: [],
    }).success,
  ).toBe(false);
});
