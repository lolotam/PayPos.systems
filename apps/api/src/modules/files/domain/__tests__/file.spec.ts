import { describe, expect, it } from 'vitest';
import { readyKey, validateStoredPermission, type FileRecord } from '../file.ts';
const file: FileRecord = {
  id: 'file',
  businessId: 'business',
  branchId: null,
  createdBy: 'user',
  requiredPermission: 'read:files:business',
  stagingKey: 'staging',
  storageKey: 'verified',
  contentType: 'application/pdf',
  sizeBytes: 10,
  status: 'READY',
};
describe('usable file lifecycle', () => {
  it('returns only a READY object key', () => expect(readyKey(file)).toBe('verified'));
  it.each(['PENDING', 'VERIFYING', 'REJECTED'] as const)('refuses %s', (status) =>
    expect(() => readyKey({ ...file, status })).toThrow('FILE_NOT_READY'),
  );
  it('refuses a READY record without a verified key', () =>
    expect(() => readyKey({ ...file, storageKey: null })).toThrow('FILE_NOT_READY'));
});

it('staff documents cannot substitute a broader permission for the PR 7a stored read permission', () => {
  expect(() => validateStoredPermission('staff', 'read:files:business')).not.toThrow();
  expect(() => validateStoredPermission('staff', 'read:businesses:company')).toThrow('FORBIDDEN');
});
