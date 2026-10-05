import { expect, it } from 'vitest';
import {
  requireAcceptedImportExpiry,
  requireImportBranches,
  type ImportCommitPreview,
} from './employee-import.ts';

const preview: ImportCommitPreview = {
  id: 'synthetic',
  business_id: 'business',
  created_by: 'creator',
  status: 'commit_requested',
  expires_at: '2026-10-05T10:00:00Z',
  requested_at: '2026-10-05T09:59:59.999Z',
  rows: [],
  errors: [],
};
it('accepts the final millisecond before expiry and rejects equality or a later request', () => {
  expect(() => requireAcceptedImportExpiry(preview)).not.toThrow();
  for (const requested_at of ['2026-10-05T10:00:00Z', '2026-10-05T10:00:00.001Z'])
    expect(() => requireAcceptedImportExpiry({ ...preview, requested_at })).toThrow(
      'IMPORT_PREVIEW_EXPIRED',
    );
});
it('requires every stored primary branch to remain in the locked business set', () => {
  const row = {
    primary_branch_id: 'branch',
    name_en: 'Synthetic',
    name_ar: null,
    role_code: 'staff',
    hire_date: '2026-01-01',
    contract_end: null,
  };
  expect(() => requireImportBranches([row], new Set(['branch']))).not.toThrow();
  expect(() => requireImportBranches([row], new Set())).toThrow('EMPLOYEE_BRANCH_NOT_FOUND');
});
