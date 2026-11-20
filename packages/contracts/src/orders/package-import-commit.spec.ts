import { expect, it } from 'vitest';
import { packageImportCommitJob, packageImportCommitRequested } from './package-import-commit.js';

const id = '00000000-0000-7000-8000-000000000001';

it('keeps the commit event and job id-only, refusing extra or malformed fields', () => {
  expect(packageImportCommitRequested.parse({ preview_id: id })).toEqual({ preview_id: id });
  expect(
    packageImportCommitRequested.safeParse({ preview_id: id, phone: '+99912345678' }).success,
  ).toBe(false);
  expect(packageImportCommitRequested.safeParse({ preview_id: 'not-a-uuid' }).success).toBe(false);
  expect(packageImportCommitJob.parse({ companyId: id, previewId: id })).toEqual({
    companyId: id,
    previewId: id,
  });
  expect(
    packageImportCommitJob.safeParse({ companyId: id, previewId: id, aggregateType: 'x' }).success,
  ).toBe(false);
  expect(packageImportCommitJob.safeParse({ companyId: id }).success).toBe(false);
  expect(packageImportCommitJob.safeParse({ companyId: 'not-a-uuid', previewId: id }).success).toBe(
    false,
  );
});
