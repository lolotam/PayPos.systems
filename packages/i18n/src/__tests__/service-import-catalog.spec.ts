import { expect, it, describe } from 'vitest';

import { ar } from '../ar.js';
import { en } from '../en.js';
import { serviceImportAr, serviceImportEn } from '../service-import.js';

// رموز أخطاء الصف الاثنا عشر وأعمدة الاستيراد التسعة في مواصفة 072.
const ERROR_CODES = [
  'IMPORT_REQUIRED_CELL',
  'IMPORT_NAME_INVALID',
  'IMPORT_PRICE_INVALID',
  'IMPORT_COMMISSION_RULE_INVALID',
  'IMPORT_COMMISSION_VALUE_INVALID',
  'IMPORT_BOOLEAN_INVALID',
  'IMPORT_DURATION_INVALID',
  'IMPORT_CATEGORY_NOT_FOUND',
  'IMPORT_CELL_INVALID',
  'IMPORT_COLUMN_UNEXPECTED',
  'IMPORT_DUPLICATE_IN_FILE',
  'IMPORT_SERVICE_EXISTS',
] as const;

const COLUMNS = [
  'name_en',
  'name_ar',
  'price',
  'duration_minutes',
  'category',
  'commission_rule',
  'commission_value',
  'counts_toward_threshold',
  'unexpected_column',
] as const;

describe('service-import catalog (A-3)', () => {
  it('carries both languages for every row error code and column name', () => {
    for (const code of ERROR_CODES) {
      expect(serviceImportEn[`code_${code}`]).toMatch(/\S/);
      expect(serviceImportAr[`code_${code}`]).toMatch(/\S/);
    }
    for (const column of COLUMNS) {
      expect(serviceImportEn[`column_${column}`]).toMatch(/\S/);
      expect(serviceImportAr[`column_${column}`]).toMatch(/\S/);
    }
  });

  it('registers the section in both catalogs under the same keys', () => {
    expect(Object.keys(ar.catalogServiceImport).sort()).toEqual(
      Object.keys(en.catalogServiceImport).sort(),
    );
    expect(Object.keys(en.catalogServiceImport).length).toBe(
      ERROR_CODES.length + COLUMNS.length,
    );
  });
});
