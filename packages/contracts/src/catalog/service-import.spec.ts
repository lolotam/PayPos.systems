import { describe, expect, it } from 'vitest';

import {
  commitServiceImportInput,
  previewServiceImportInput,
  serviceImportPreview,
  serviceImportRow,
  serviceImportRowError,
  serviceImportRowsQuery,
  serviceImportStatus,
} from './service-import.js';

const baseRow = {
  row: 2,
  name_en: 'Hair Cut',
  name_ar: null,
  price: '12.500',
  duration_minutes: null,
  category_id: null,
  category_name_en: null,
  commission_rule: { kind: 'FOLLOW_PLAN' },
  commission_value: null,
  commission_rule_defaulted: true,
  counts_toward_threshold: true,
} as const;

describe('service-import row schemas', () => {
  it('accepts a normalized row with a PCT value as integer basis points', () => {
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'PCT', value: 2000 },
        commission_value: 2000,
      }).success,
    ).toBe(true);
  });

  it('accepts a normalized row with a FIXED value as a 3-decimal string', () => {
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'FIXED', value: '0.500' },
        commission_value: '0.500',
        commission_rule_defaulted: false,
      }).success,
    ).toBe(true);
  });

  it('refuses a number as the price and a fourth decimal in any money string', () => {
    expect(serviceImportRow.safeParse({ ...baseRow, price: 12.5 }).success).toBe(false);
    expect(serviceImportRow.safeParse({ ...baseRow, price: '12.5000' }).success).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'FIXED', value: '0.5000' },
        commission_value: '0.5000',
      }).success,
    ).toBe(false);
  });

  it('refuses a row below 2 and a non-integer PCT value', () => {
    expect(serviceImportRow.safeParse({ ...baseRow, row: 1 }).success).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'PCT', value: 20.5 },
        commission_value: 20.5,
      }).success,
    ).toBe(false);
  });

  it('accepts every row-error shape and refuses an unknown column', () => {
    expect(
      serviceImportRowError.safeParse({ row: 3, column: 'price', code: 'IMPORT_PRICE_INVALID' })
        .success,
    ).toBe(true);
    expect(
      serviceImportRowError.safeParse({ row: 2, column: 'country', code: 'IMPORT_CELL_INVALID' })
        .success,
    ).toBe(false);
  });
});

describe('commission rule and value correlation', () => {
  it('correlates the value with the rule: mismatched kinds, values and set FOLLOW_PLAN/ZERO values are refused', () => {
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'PCT', value: 2000 },
        commission_value: '20.000',
        commission_rule_defaulted: false,
      }).success,
    ).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'FIXED', value: '0.500' },
        commission_value: 500,
        commission_rule_defaulted: false,
      }).success,
    ).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'PCT', value: 2000 },
        commission_value: 1500,
        commission_rule_defaulted: false,
      }).success,
    ).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'ZERO' },
        commission_value: 0,
        commission_rule_defaulted: false,
      }).success,
    ).toBe(false);
    expect(
      serviceImportRow.safeParse({
        ...baseRow,
        commission_rule: { kind: 'PCT', value: 2000 },
        commission_value: 2000,
        commission_rule_defaulted: false,
      }).success,
    ).toBe(true);
  });
});

describe('service-import preview and commit shapes', () => {
  it('accepts the preview with up to 100 rows and a null cursor', () => {
    expect(
      serviceImportPreview.safeParse({
        preview_id: '018f0000-0000-7000-8000-000000000000',
        row_count: 1,
        error_count: 0,
        errors: [],
        rows: [baseRow],
        next_cursor: null,
      }).success,
    ).toBe(true);
    expect(
      serviceImportPreview.safeParse({
        preview_id: '018f0000-0000-7000-8000-000000000000',
        row_count: 101,
        error_count: 0,
        errors: [],
        rows: Array.from({ length: 101 }, (_, index) => ({ ...baseRow, row: index + 2 })),
        next_cursor: null,
      }).success,
    ).toBe(false);
  });

  it('keeps the rows query between 1 and 100 and coerces the limit', () => {
    expect(serviceImportRowsQuery.safeParse({ limit: '50' })).toMatchObject({
      success: true,
      data: { limit: 50 },
    });
    expect(serviceImportRowsQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(serviceImportRowsQuery.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('accepts the preview input, the commit input and the acceptance', () => {
    const fileId = '018f0000-0000-7000-8000-000000000001';
    const previewId = '018f0000-0000-7000-8000-000000000002';
    expect(previewServiceImportInput.safeParse({ file_id: fileId }).success).toBe(true);
    expect(commitServiceImportInput.safeParse({ preview_id: previewId }).success).toBe(true);
  });

  it('lists the status error codes of 072 and accepts a null code', () => {
    const accepted = serviceImportStatus.safeParse({
      preview_id: '018f0000-0000-7000-8000-000000000003',
      status: 'ready',
      created_count: 0,
      error_code: null,
    });
    expect(accepted.success).toBe(true);
    expect(
      serviceImportStatus.safeParse({
        preview_id: '018f0000-0000-7000-8000-000000000003',
        status: 'failed',
        created_count: 0,
        error_code: 'IMPORT_NAME_INVALID',
      }).success,
    ).toBe(false);
  });
});
