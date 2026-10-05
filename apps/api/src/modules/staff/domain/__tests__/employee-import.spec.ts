import { describe, expect, it } from 'vitest';

import {
  branchNameIndex,
  EMPLOYEE_IMPORT_MAX_BYTES,
  EmployeeImportError,
  validateEmployeeImportFile,
  requireEmployeeImportRequestExpiry,
  type EmployeeImportFileFacts,
} from '../employee-import.ts';

const facts: EmployeeImportFileFacts = {
  business_id: 'business',
  created_by: 'importer',
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 1024,
  status: 'READY',
  storage_key: 'verified/key',
  purged: false,
};

const refuse = (change: Partial<EmployeeImportFileFacts>) =>
  validateEmployeeImportFile({ ...facts, ...change }, 'business', 'importer');

describe('validateEmployeeImportFile owner decision PR 11', () => {
  it('accepts a READY xlsx within the import bounds', () => {
    expect(() => refuse({})).not.toThrow();
    expect(() => refuse({ size_bytes: EMPLOYEE_IMPORT_MAX_BYTES })).not.toThrow();
  });

  it.each([
    [{ business_id: 'other' }],
    [{ created_by: 'someone-else' }],
    [{ purged: true }],
    [{ storage_key: null }],
  ] as const)('hides any ownership or existence mismatch as not found', (change) => {
    expect(() => refuse(change)).toThrow(new EmployeeImportError('IMPORT_FILE_NOT_FOUND'));
  });

  it('answers null as not found without describing the missing file', () => {
    expect(() => validateEmployeeImportFile(null, 'business', 'importer')).toThrow(
      new EmployeeImportError('IMPORT_FILE_NOT_FOUND'),
    );
  });

  it('refuses a file that has not passed verification', () => {
    expect(() => refuse({ status: 'PENDING' })).toThrow(
      new EmployeeImportError('IMPORT_FILE_NOT_READY'),
    );
    expect(() => refuse({ status: 'REJECTED' })).toThrow(
      new EmployeeImportError('IMPORT_FILE_NOT_READY'),
    );
  });

  it('refuses another content type and a size over 2 MiB', () => {
    expect(() => refuse({ content_type: 'application/pdf' })).toThrow(
      new EmployeeImportError('IMPORT_FILE_TYPE_INVALID'),
    );
    expect(() => refuse({ size_bytes: EMPLOYEE_IMPORT_MAX_BYTES + 1 })).toThrow(
      new EmployeeImportError('IMPORT_FILE_SIZE_INVALID'),
    );
    expect(() => refuse({ size_bytes: 0 })).toThrow(
      new EmployeeImportError('IMPORT_FILE_SIZE_INVALID'),
    );
  });
});

describe('requireEmployeeImportRequestExpiry', () => {
  const expiresAt = '2026-10-06T10:00:00.000Z';
  it('accepts an instant strictly before expiry', () => {
    expect(() =>
      requireEmployeeImportRequestExpiry(expiresAt, new Date('2026-10-06T09:59:59.999Z')),
    ).not.toThrow();
  });
  it.each([expiresAt, '2026-10-06T10:00:00.001Z'])(
    'refuses equality or later request time %s',
    (requestedAt) => {
      expect(() => requireEmployeeImportRequestExpiry(expiresAt, new Date(requestedAt))).toThrow(
        new EmployeeImportError('IMPORT_PREVIEW_EXPIRED'),
      );
    },
  );
});

describe('branchNameIndex', () => {
  it('keeps duplicate normalized aliases belonging to the same branch', () => {
    const index = branchNameIndex([
      { id: 'b1', name_en: ' Main ', name_ar: 'MAIN' },
      { id: 'b1', name_en: 'main', name_ar: null },
    ]);
    expect(index.get('main')).toBe('b1');
  });

  it('rejects duplicate aliases only when different branch ids share the key', () => {
    const index = branchNameIndex([
      { id: 'b1', name_en: 'Main', name_ar: ' MAIN ' },
      { id: 'b2', name_en: 'Other', name_ar: 'main' },
    ]);
    expect(index.has('main')).toBe(false);
    expect(index.get('other')).toBe('b2');
  });

  it('maps English and Arabic branch names case-insensitively', () => {
    const index = branchNameIndex([
      { id: 'b1', name_en: 'Main', name_ar: 'الرئيسي' },
      { id: 'b2', name_en: 'Salmiya', name_ar: null },
    ]);
    expect(index.get('main')).toBe('b1');
    expect(index.get('الرئيسي')).toBe('b1');
    expect(index.get('salmiya')).toBe('b2');
  });

  it('drops an ambiguous name rather than guessing a branch', () => {
    const index = branchNameIndex([
      { id: 'b1', name_en: 'Main', name_ar: null },
      { id: 'b2', name_en: 'main', name_ar: null },
      { id: 'b3', name_en: 'Other', name_ar: 'Main' },
    ]);
    expect(index.get('main')).toBeUndefined();
    expect(index.get('other')).toBe('b3');
  });

  it('ignores blank names and trims before matching', () => {
    const index = branchNameIndex([{ id: 'b1', name_en: '  Main  ', name_ar: '   ' }]);
    expect([...index]).toEqual([['main', 'b1']]);
  });
});
