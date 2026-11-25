import { describe, expect, it } from 'vitest';

import { t } from '../catalog.js';
import { packageImportAr, packageImportEn } from '../package-import-catalog.js';

// عناوين قالب الباقات بعد حذف اللاحقة الرقمية، كما يستخدمها منشئ القالب لملاحظات الخلايا وورقة المرجع.
const HEADER_NOTES = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
  'service',
  'sessions',
  'remaining',
  'reference_service_en',
  'reference_service_ar',
] as const;

// رموز الصف الخمسة عشر في عقد المعاينة، ورموز فشل الحالة التي لا ينتجها صف.
const ERROR_CODES = [
  'IMPORT_CELL_INVALID',
  'IMPORT_PHONE_INVALID',
  'IMPORT_NAME_INVALID',
  'INVALID_PRICE',
  'IMPORT_DATE_INVALID',
  'IMPORT_EXTERNAL_REF_INVALID',
  'IMPORT_REQUIRED_CELL',
  'IMPORT_SERVICE_AMBIGUOUS',
  'IMPORT_SERVICE_NOT_FOUND',
  'INVALID_COMPONENTS',
  'DUPLICATE_SERVICE',
  'INVALID_SESSIONS',
  'INVALID_REMAINING_SESSIONS',
  'IMPORT_CUSTOMER_NOT_FOUND',
  'IMPORT_EXTERNAL_REF_DUPLICATE',
  'IMPORT_COMMIT_FAILED',
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_PREVIEW_HAS_ERRORS',
] as const;

const COLUMNS = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
  'service',
  'sessions',
  'remaining',
  'unexpected_column',
] as const;

describe('package-import catalog', () => {
  it('has both languages for every template note, column label and error code', () => {
    for (const key of HEADER_NOTES) {
      expect(packageImportEn[key]).toMatch(/\S/);
      expect(packageImportAr[key]).toMatch(/[؀-ۿ]/);
    }
    for (const column of COLUMNS) {
      expect(packageImportEn[`col_${column}`]).toMatch(/\S/);
      expect(packageImportAr[`col_${column}`]).toMatch(/[؀-ۿ]/);
    }
    for (const code of ERROR_CODES) {
      expect(packageImportEn[`code_${code}`]).toMatch(/\S/);
      expect(packageImportAr[`code_${code}`]).toMatch(/[؀-ۿ]/);
    }
  });

  it('keeps the same keys in both languages and resolves them through the registry', () => {
    expect(Object.keys(packageImportAr).sort()).toEqual(Object.keys(packageImportEn).sort());
    expect(t('ar', 'packageImport.navTitle')).toBe(packageImportAr.navTitle);
    expect(t('en', 'packageImport.navTitle')).toBe(packageImportEn.navTitle);
  });
});
