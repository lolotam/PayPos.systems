import { describe, expect, it } from 'vitest';

import { ar } from '../ar.js';
import { customerImportAr, customerImportEn } from '../customer-import.js';
import { en } from '../en.js';

const COLUMNS = [
  'name',
  'phone',
  'country_code',
  'locale',
  'no_rating',
  'birthday',
  'year_known',
  'gender',
  'email',
  'notes',
  'unexpected_column',
] as const;

const ERROR_CODES = [
  'IMPORT_REQUIRED_CELL',
  'IMPORT_NAME_INVALID',
  'IMPORT_PHONE_INVALID',
  'IMPORT_COUNTRY_CODE_INVALID',
  'IMPORT_LOCALE_INVALID',
  'IMPORT_BOOLEAN_INVALID',
  'IMPORT_DATE_INVALID',
  'IMPORT_YEAR_KNOWN_REQUIRED',
  'IMPORT_GENDER_INVALID',
  'IMPORT_EMAIL_INVALID',
  'IMPORT_NOTE_INVALID',
  'IMPORT_CELL_INVALID',
  'IMPORT_COLUMN_UNEXPECTED',
  'IMPORT_DUPLICATE_IN_FILE',
] as const;

const COMMIT_CODES = [
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_PREVIEW_HAS_ERRORS',
  'IMPORT_COMMIT_FAILED',
] as const;

const SCREEN_LABELS = [
  'title',
  'lead',
  'sectionTemplate',
  'sectionFile',
  'download',
  'choose',
  'preview',
  'commit',
  'clean',
  'rowCount',
  'newCount',
  'existingCount',
  'errorsTitle',
  'rowsTitle',
  'row',
  'column',
  'reason',
  'locale_ar',
  'locale_en',
  'status_new',
  'status_existing',
  'emptyValue',
  'loadMoreRows',
  'loadingMoreRows',
  'committed',
  'pending',
  'delayed',
  'failed',
  'chooseBranch',
  'checking',
] as const;

const TABLE_HEADERS = [
  ...COLUMNS.filter((column) => column !== 'unexpected_column'),
  'status',
  'warning',
];

describe('customer-import catalog (073 34b)', () => {
  it('carries both languages for every column hint, header and row error code', () => {
    for (const column of COLUMNS) {
      expect(customerImportEn[`col_${column}`]).toMatch(/\S/);
      expect(customerImportAr[`col_${column}`]).toMatch(/\S/);
    }
    for (const column of COLUMNS.filter((name) => name !== 'unexpected_column')) {
      expect(customerImportEn[`column_${column}`]).toMatch(/\S/);
      expect(customerImportAr[`column_${column}`]).toMatch(/\S/);
    }
    for (const code of ERROR_CODES) {
      expect(customerImportEn[`code_${code}`]).toMatch(/\S/);
      expect(customerImportAr[`code_${code}`]).toMatch(/\S/);
    }
    for (const header of TABLE_HEADERS) {
      expect(customerImportEn[`col_${header}` as keyof typeof customerImportEn]).toMatch(/\S/);
      expect(customerImportAr[`col_${header}` as keyof typeof customerImportAr]).toMatch(/\S/);
    }
  });

  it('carries the warning and the three commit refusal codes in both languages', () => {
    expect(customerImportEn.warning_EXISTING_NO_RATING_IGNORED).toMatch(/\S/);
    expect(customerImportAr.warning_EXISTING_NO_RATING_IGNORED).toBe(
      'موجودة — رفض التقييم مش هيتسجّل',
    );
    for (const code of COMMIT_CODES) {
      expect(customerImportEn[`commit_${code}`]).toMatch(/\S/);
      expect(customerImportAr[`commit_${code}`]).toMatch(/\S/);
    }
  });

  it('carries both languages for every screen label', () => {
    for (const label of SCREEN_LABELS) {
      expect(customerImportEn[label]).toMatch(/\S/);
      expect(customerImportAr[label]).toMatch(/\S/);
    }
    expect(customerImportAr.title).not.toBe(customerImportEn.title);
  });

  it('registers the section in both catalogs under the same keys', () => {
    expect(Object.keys(ar.customerImport).sort()).toEqual(Object.keys(en.customerImport).sort());
  });
});
