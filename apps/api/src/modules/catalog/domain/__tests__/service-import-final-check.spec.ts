import { describe, expect, it } from 'vitest';

import { serviceTerms } from '../service.ts';
import {
  bool,
  goodRow,
  HAIR,
  mapRows,
  mapRowsWithResolver,
  numeric,
  text,
} from './service-import-row-test-support.ts';

// بنود الصف المطبّع كما تحسبها serviceTerms نفسها، ثابتة على مستوى الملف لاختبار الاتفاق بين المحوّل والفحص النهائي.
const spaTerms = serviceTerms({
  name_en: 'Spa',
  name_ar: 'سبا',
  price: '9.000',
  commission_rule: { kind: 'FIXED', value: '1.500' },
  counts_toward_threshold: false,
  duration_minutes: 45,
  category_id: HAIR,
});

describe('the final serviceTerms check (A-7, SR-006)', () => {
  it('accepts a row the mapper validated through the same serviceTerms rules', () => {
    const result = mapRows([
      {
        row: 2,
        cells: goodRow('Cut', {
          duration_minutes: numeric('600'),
          category: text('Hair Care'),
          commission_rule: text('FIXED'),
          commission_value: text('0.250'),
        }),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      duration_minutes: 600,
      category_id: HAIR,
      commission_rule: { kind: 'FIXED', value: '0.250' },
      commission_value: '0.250',
    });
  });

  it('returns rows serviceTerms accepts with equal values — one conversion, no second engine', () => {
    const result = mapRows([
      {
        row: 2,
        cells: goodRow('Spa', {
          name_ar: text(' سبا '),
          price: text('9'),
          duration_minutes: numeric('45'),
          category: text('Hair Care'),
          commission_rule: text('FIXED'),
          commission_value: text('1.5'),
          counts_toward_threshold: bool(false),
        }),
      },
      { row: 3, cells: goodRow('Nails', { commission_rule: text(' '), commission_value: null }) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      name_en: spaTerms.name_en,
      name_ar: spaTerms.name_ar,
      price: '9.000',
      duration_minutes: spaTerms.duration_minutes,
      category_id: spaTerms.category_id,
      counts_toward_threshold: spaTerms.counts_toward_threshold,
    });
    expect(result.rows[1]).toMatchObject({
      commission_rule: { kind: 'FOLLOW_PLAN' },
      commission_value: null,
      commission_rule_defaulted: true,
    });
  });
});

describe('trim agreement and closed categories (A-7, FR-004)', () => {
  it('reads a whitespace-only name cell as required at the converter, matching the trim serviceTerms applies', () => {
    const result = mapRows([{ row: 2, cells: goodRow('\u00A0', { price: text('1.000') }) }]);
    expect(result.errors.map((error) => `${error.row}:${error.column}:${error.code}`)).toEqual([
      '2:name_en:IMPORT_REQUIRED_CELL',
    ]);
    expect(result.rows).toEqual([]);
  });

  it('maps a closed category as not-found because closed categories are never passed (FR-004)', () => {
    // التصنيفات المغلقة لا تُمرَّر أصلاً (FR-004): قائمة المفتوح تختوي على الاسم، فمطابقته رفض «مش موجود».
    const result = mapRowsWithResolver(
      [{ row: 2, cells: goodRow('Cut', { category: text('Hair Care') }) }],
      () => null,
    );
    expect(result.errors.map((error) => `${error.row}:${error.column}:${error.code}`)).toEqual([
      '2:category:IMPORT_CATEGORY_NOT_FOUND',
    ]);
  });
});

describe('money never crosses as a JavaScript number (D-9)', () => {
  it('carries the price and the FIXED value as strings and the PCT value as an integer', () => {
    const result = mapRows([
      {
        row: 2,
        cells: goodRow('A', { commission_rule: text('PCT'), commission_value: text('12.5') }),
      },
      { row: 3, cells: goodRow('B', { commission_rule: text('FIXED'), commission_value: text('3') }) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.commission_value).toBe(1250);
    expect(result.rows[0]?.price).toBe('12.500');
    expect(result.rows[1]?.commission_value).toBe('3.000');
    expect(typeof result.rows[1]?.commission_value).toBe('string');
  });
});
