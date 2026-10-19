import { describe, expect, it } from 'vitest';
import {
  effectiveReadPermission,
  readyKey,
  uploadAuthority,
  validateSettingsUpload,
  validateStoredPermission,
  type FileRecord,
} from '../file.ts';
const file: FileRecord = {
  id: 'file',
  businessId: 'business',
  branchId: null,
  createdBy: 'user',
  ownerModule: 'staff',
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
  expect(() => validateStoredPermission('staff', 'read:settings:business')).toThrow('FORBIDDEN');
});

it('settings files store the identity permission and open on that permission alone', () => {
  expect(uploadAuthority('settings')).toBe('manage:business-identity:business');
  expect(uploadAuthority('staff')).toBe('manage:files:business');
  expect(() =>
    validateStoredPermission('settings', 'manage:business-identity:business'),
  ).not.toThrow();
  expect(() => validateStoredPermission('settings', 'read:settings:business')).toThrow('FORBIDDEN');
  expect(() => validateStoredPermission('settings', 'read:settings:company')).toThrow('FORBIDDEN');
  expect(() => validateStoredPermission('settings', 'read:files:business')).toThrow('FORBIDDEN');
  expect(() => validateStoredPermission('settings', 'manage:files:business')).toThrow('FORBIDDEN');
});

it('an owner kind without a stored-permission pin is unchanged', () => {
  expect(() => validateStoredPermission('customers', 'read:customers:business')).not.toThrow();
});

it('derives a settings read from the owner module and leaves a staff document on its stored permission', () => {
  expect(effectiveReadPermission('settings', 'read:settings:business')).toBe(
    'manage:business-identity:business',
  );
  expect(effectiveReadPermission('settings', 'manage:business-identity:business')).toBe(
    'manage:business-identity:business',
  );
  expect(effectiveReadPermission('staff', 'read:files:business')).toBe('read:files:business');
});

it('limits a settings upload to an unbranched PNG or JPEG owned by the route business', () => {
  const logo = {
    ownerModule: 'settings',
    ownerEntityId: 'BUSINESS',
    branchId: null,
    contentType: 'image/png',
  };
  expect(() => validateSettingsUpload(logo, 'business')).not.toThrow();
  expect(() =>
    validateSettingsUpload({ ...logo, contentType: 'image/jpeg' }, 'business'),
  ).not.toThrow();
  expect(() =>
    validateSettingsUpload({ ...logo, contentType: 'application/pdf' }, 'business'),
  ).toThrow('FILE_TYPE_INVALID');
  expect(() => validateSettingsUpload({ ...logo, ownerEntityId: 'other' }, 'business')).toThrow(
    'FORBIDDEN',
  );
  expect(() => validateSettingsUpload({ ...logo, branchId: 'branch' }, 'business')).toThrow(
    'FORBIDDEN',
  );
  expect(() =>
    validateSettingsUpload(
      { ...logo, ownerModule: 'staff', ownerEntityId: 'employee', contentType: 'application/pdf' },
      'business',
    ),
  ).not.toThrow();
});
