import { expect, it } from 'vitest';

import { ServiceImportError } from '../errors.ts';
import { validateServiceImportFile, type ServiceImportFileFacts } from '../service-import-file.ts';
import { SERVICE_IMPORT_MAX_BYTES } from '../service-import.ts';
import { SERVICE_IMPORT_CONTENT_TYPE } from '../service-import-template.ts';

// ملكية الملف ووثوقه: الملف المجهول أو الخارج عن النشاط أو غير منشئه أو المنظّف كله رفض
// «غير موجود» دون كشف وجوده، والملف غير الوثوق أو غير xlsx أو فوق 2 MiB رفض مسمّى خاص به.

const BUSINESS_ID = '01920000-0000-7000-8000-0000000000a2';
const USER_ID = '01920000-0000-7000-8000-0000000000b3';
const OTHER_ID = '01920000-0000-7000-8000-0000000000ff';
const STORAGE_KEY = 'catalog/imports/verified-services.xlsx';

function facts(overrides: Partial<ServiceImportFileFacts> = {}): ServiceImportFileFacts {
  return {
    business_id: BUSINESS_ID,
    created_by: USER_ID,
    owner_module: 'catalog',
    content_type: SERVICE_IMPORT_CONTENT_TYPE,
    size_bytes: 1024,
    status: 'READY',
    storage_key: STORAGE_KEY,
    purged: false,
    purge_started: false,
    ...overrides,
  };
}

function refusalCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceImportError);
    return (error as ServiceImportError).code;
  }
  throw new Error('the file validation was expected to refuse these facts');
}

const NOT_FOUND: { name: string; value: ServiceImportFileFacts | null }[] = [
  { name: 'missing facts', value: null },
  { name: 'a purged file', value: facts({ purged: true }) },
  { name: 'a file whose purge started', value: facts({ purge_started: true }) },
  { name: 'a file uploaded for another module', value: facts({ owner_module: 'customers' }) },
  { name: 'a file of another business', value: facts({ business_id: OTHER_ID }) },
  { name: 'a file of another uploader', value: facts({ created_by: OTHER_ID }) },
  { name: 'a verified file without a storage key', value: facts({ storage_key: null }) },
];

it.each(NOT_FOUND)('refuses $name as not found', ({ value }) => {
  expect(refusalCode(() => validateServiceImportFile(value, BUSINESS_ID, USER_ID))).toBe(
    'IMPORT_FILE_NOT_FOUND',
  );
});

it.each(['PENDING', 'VERIFYING', 'REJECTED'] as const)(
  'refuses a %s file as not ready',
  (status) => {
    expect(
      refusalCode(() => validateServiceImportFile(facts({ status }), BUSINESS_ID, USER_ID)),
    ).toBe('IMPORT_FILE_NOT_READY');
  },
);

it('refuses a file that is not the import workbook', () => {
  expect(
    refusalCode(() =>
      validateServiceImportFile(facts({ content_type: 'application/pdf' }), BUSINESS_ID, USER_ID),
    ),
  ).toBe('IMPORT_FILE_TYPE_INVALID');
});

it.each([0, -1, 1.5, SERVICE_IMPORT_MAX_BYTES + 1])('refuses a file of %s bytes', (size_bytes) => {
  expect(
    refusalCode(() => validateServiceImportFile(facts({ size_bytes }), BUSINESS_ID, USER_ID)),
  ).toBe('IMPORT_FILE_SIZE_INVALID');
});

it('accepts a file at the maximum size', () => {
  expect(
    validateServiceImportFile(
      facts({ size_bytes: SERVICE_IMPORT_MAX_BYTES }),
      BUSINESS_ID,
      USER_ID,
    ),
  ).toBe(STORAGE_KEY);
});

it('accepts a mixed-case business and uploader because the guard accepts any UUID case', () => {
  expect(BUSINESS_ID.toUpperCase()).not.toBe(BUSINESS_ID);
  expect(USER_ID.toUpperCase()).not.toBe(USER_ID);
  expect(
    validateServiceImportFile(
      facts({ business_id: BUSINESS_ID.toUpperCase(), created_by: USER_ID.toUpperCase() }),
      BUSINESS_ID,
      USER_ID,
    ),
  ).toBe(STORAGE_KEY);
  expect(
    validateServiceImportFile(facts(), BUSINESS_ID.toUpperCase(), USER_ID.toUpperCase()),
  ).toBe(STORAGE_KEY);
});

it('returns the storage key of a valid file', () => {
  expect(validateServiceImportFile(facts(), BUSINESS_ID, USER_ID)).toBe(STORAGE_KEY);
});
