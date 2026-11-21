import { describe, expect, it } from 'vitest';

import {
  bool,
  codes,
  errorCell,
  expectedRow,
  goodRow,
  HAIR,
  mapRows,
  numeric,
  text,
  unrepresentable,
} from './service-import-row-test-support.ts';

describe('a fully valid sheet', () => {
  it('normalizes every row in sheet order with the stored category name and defaults', () => {
    const result = mapRows([
      { row: 2, cells: goodRow() },
      { row: 5, cells: goodRow('Nails', { name_ar: text(' أظافر '), price: text('7.500') }) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      expectedRow(2, 'Hair Cut'),
      expectedRow(5, 'Nails', { name_ar: 'أظافر', price: '7.500' }),
    ]);
  });

  it('matches a category cell through the caller resolver, preserving UUID and display name', () => {
    const result = mapRows([{ row: 2, cells: goodRow('Cut', { category: text('Hair Care') }) }]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ category_id: HAIR, category_name_en: 'Hair Care' });
  });

  it('treats a spelling the resolver does not map as an unknown category (no JS folding)', () => {
    const result = mapRows([{ row: 2, cells: goodRow('Cut', { category: text('  hair  care ') }) }]);
    expect(codes(result.errors)).toEqual(['2:category:IMPORT_CATEGORY_NOT_FOUND']);
  });
});

describe('optional columns and rule defaults', () => {
  it('gives an absent optional column no value for every row (headers without optionals)', () => {
    const result = mapRows([{ row: 2, cells: goodRow('Cut') }], [
      'name_en',
      'name_ar',
      'price',
      'commission_rule',
      'commission_value',
      'counts_toward_threshold',
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ duration_minutes: null, category_id: null });
  });

  it('keeps a blank commission rule as FOLLOW_PLAN with the defaulted flag and null value', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('Cut', { commission_rule: text('  '), commission_value: null }) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      commission_rule: { kind: 'FOLLOW_PLAN' },
      commission_value: null,
      commission_rule_defaulted: true,
    });
  });

  it('normalizes FIXED to a 3-decimal string value', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('Cut', { commission_rule: text('FIXED'), commission_value: text('0.5') }) },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      commission_rule: { kind: 'FIXED', value: '0.500' },
      commission_value: '0.500',
    });
  });

  it('accepts duration through numeric text and counts through a boolean cell', () => {
    const result = mapRows([
      {
        row: 2,
        cells: goodRow('Cut', { duration_minutes: numeric('090'), counts_toward_threshold: bool(false) }),
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ duration_minutes: 90, counts_toward_threshold: false });
  });
});

describe('every row error code of 072', () => {
  it('reports IMPORT_REQUIRED_CELL for a missing name_en and for a PCT value without a value', () => {
    const result = mapRows([
      { row: 2, cells: { name_en: null, price: text('1.000') } },
      {
        row: 3,
        cells: goodRow('Cut', { commission_rule: text('PCT'), commission_value: null }),
      },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:name_en:IMPORT_REQUIRED_CELL',
      '3:commission_value:IMPORT_REQUIRED_CELL',
    ]);
    expect(result.rows).toEqual([]);
  });

  it('reports IMPORT_NAME_INVALID for a boolean name cell', () => {
    const result = mapRows([{ row: 2, cells: { name_en: bool(true), price: text('1.000') } }]);
    expect(codes(result.errors)).toEqual(['2:name_en:IMPORT_NAME_INVALID']);
  });

  it('reports IMPORT_PRICE_INVALID for a boolean price and a 16-digit value', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('A', { price: bool(false) }) },
      { row: 3, cells: goodRow('B', { price: unrepresentable('1234567890123456') }) },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:price:IMPORT_PRICE_INVALID',
      '3:price:IMPORT_PRICE_INVALID',
    ]);
  });

  it('reports IMPORT_DURATION_INVALID for 0, 601 and a boolean duration', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('A', { duration_minutes: text('0') }) },
      { row: 3, cells: goodRow('B', { duration_minutes: text('601') }) },
      { row: 4, cells: goodRow('C', { duration_minutes: bool(true) }) },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:duration_minutes:IMPORT_DURATION_INVALID',
      '3:duration_minutes:IMPORT_DURATION_INVALID',
      '4:duration_minutes:IMPORT_DURATION_INVALID',
    ]);
  });

  it('reports IMPORT_CATEGORY_NOT_FOUND for an unknown name and a boolean cell', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('A', { category: text('Nails') }) },
      { row: 3, cells: goodRow('B', { category: bool(false) }) },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:category:IMPORT_CATEGORY_NOT_FOUND',
      '3:category:IMPORT_CATEGORY_NOT_FOUND',
    ]);
  });

  it('reports IMPORT_BOOLEAN_INVALID for an unknown counts word', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('A', { counts_toward_threshold: text('maybe') }) },
    ]);
    expect(codes(result.errors)).toEqual(['2:counts_toward_threshold:IMPORT_BOOLEAN_INVALID']);
  });
});

describe('broken excel cells never become defaults (SIT-16)', () => {
  it('reports IMPORT_CELL_INVALID on each broken cell column and never a default', () => {
    const result = mapRows([
      {
        row: 2,
        cells: {
          name_en: text('A'),
          name_ar: errorCell(),
          price: text('1.000'),
          commission_rule: errorCell(),
          counts_toward_threshold: errorCell(),
        },
      },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:name_ar:IMPORT_CELL_INVALID',
      '2:commission_rule:IMPORT_CELL_INVALID',
      '2:counts_toward_threshold:IMPORT_CELL_INVALID',
    ]);
  });
});

describe('commission refusals and unexpected data of 072', () => {
  it('maps the commission refusal reasons to their codes and columns', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('A', { commission_rule: text('WEEKLY') }) },
      { row: 3, cells: goodRow('B', { commission_rule: text('PCT'), commission_value: text('200') }) },
      { row: 4, cells: goodRow('C', { commission_rule: errorCell() }) },
      { row: 5, cells: goodRow('D', { commission_value: errorCell() }) },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:commission_rule:IMPORT_COMMISSION_RULE_INVALID',
      '3:commission_value:IMPORT_COMMISSION_VALUE_INVALID',
      '4:commission_rule:IMPORT_CELL_INVALID',
      '5:commission_value:IMPORT_CELL_INVALID',
    ]);
  });

  it('reports IMPORT_COLUMN_UNEXPECTED once per row with data past the last header', () => {
    const result = mapRows([
      {
        row: 2,
        cells: { ...goodRow('A'), extra: [text('stray')] },
      },
    ]);
    expect(codes(result.errors)).toEqual(['2:unexpected_column:IMPORT_COLUMN_UNEXPECTED']);
    expect(result.rows).toEqual([]);
  });
});

describe('in-file duplicates inside a sheet (A-10)', () => {
  it('reports IMPORT_DUPLICATE_IN_FILE on every member including rows with other errors', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('Hair Cut', { price: text('1.000') }) },
      { row: 3, cells: goodRow('hair  CUT', { price: bool(true) }) },
      { row: 4, cells: goodRow('Nails') },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:name_en:IMPORT_DUPLICATE_IN_FILE',
      '3:name_en:IMPORT_DUPLICATE_IN_FILE',
      '3:price:IMPORT_PRICE_INVALID',
    ]);
    // الصف الرابع اسمه مختلف، فهو الوحيد اللي بيعدي من المجموعة المتكررة لالصفوف المطبّعة.
    expect(result.rows.map((row) => row.row)).toEqual([4]);
    expect(result.rows[0]).toMatchObject({ name_en: 'Nails', price: '12.500' });
  });
});

describe('exposed keys carried to 32b-2 (A-11)', () => {
  it('gives a key to every row with a valid name, including rows that never normalize', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('Hair Cut', { price: bool(true) }) },
      { row: 3, cells: goodRow('hair  cut') },
      { row: 4, cells: goodRow('Nails') },
      { row: 5, cells: { price: text('1.000') } },
    ]);
    expect(result.keys).toEqual([
      { row: 2, key: 'hair cut' },
      { row: 3, key: 'hair cut' },
      { row: 4, key: 'nails' },
    ]);
    expect(result.rows.map((row) => row.row)).toEqual([4]);
    expect(codes(result.errors)).toEqual([
      '2:name_en:IMPORT_DUPLICATE_IN_FILE',
      '2:price:IMPORT_PRICE_INVALID',
      '3:name_en:IMPORT_DUPLICATE_IN_FILE',
      '5:name_en:IMPORT_REQUIRED_CELL',
    ]);
  });
});

// رؤوس مرتبة على غير الترتيب المرجعي وبيانات زائدة بعد آخر عنوان، لأختبار ترتيب الأخطاء داخل الصف.
const REORDERED_HEADERS = [
  'counts_toward_threshold',
  'price',
  'name_ar',
  'duration_minutes',
  'name_en',
  'category',
  'commission_rule',
  'commission_value',
];

const REORDERED_ERRORS = [
  '2:counts_toward_threshold:IMPORT_BOOLEAN_INVALID',
  '2:price:IMPORT_PRICE_INVALID',
  '2:name_ar:IMPORT_NAME_INVALID',
  '2:duration_minutes:IMPORT_DURATION_INVALID',
  '2:category:IMPORT_CATEGORY_NOT_FOUND',
  '2:unexpected_column:IMPORT_COLUMN_UNEXPECTED',
];

describe('error shape and order (D-8)', () => {
  it('reports within-row errors in the actual header order, with unexpected_column last', () => {
    const result = mapRows(
      [
        {
          row: 2,
          cells: {
            counts_toward_threshold: numeric('1'),
            price: bool(false),
            name_ar: bool(true),
            duration_minutes: text('601'),
            name_en: text('A'),
            category: text('Nails'),
            commission_rule: text('PCT'),
            commission_value: text('10'),
            extra: [text('stray')],
          },
        },
      ],
      REORDERED_HEADERS,
    );
    expect(codes(result.errors)).toEqual(REORDERED_ERRORS);
  });

  it('reports several bad columns of one row together, once per column, in header order', () => {
    const result = mapRows([
      {
        row: 2,
        cells: goodRow('A', {
          name_ar: bool(true),
          price: bool(false),
          duration_minutes: text('601'),
          category: text('Nails'),
          counts_toward_threshold: numeric('1'),
        }),
      },
    ]);
    expect(codes(result.errors)).toEqual([
      '2:name_ar:IMPORT_NAME_INVALID',
      '2:price:IMPORT_PRICE_INVALID',
      '2:duration_minutes:IMPORT_DURATION_INVALID',
      '2:category:IMPORT_CATEGORY_NOT_FOUND',
      '2:counts_toward_threshold:IMPORT_BOOLEAN_INVALID',
    ]);
  });
});

describe('error order and normalization exclusion (D-8)', () => {
  it('keeps the errors in sheet order across rows', () => {
    const result = mapRows([
      { row: 3, cells: goodRow('A', { price: bool(true) }) },
      { row: 2, cells: goodRow('B', { price: bool(false) }) },
    ]);
    expect(codes(result.errors)).toEqual([
      '3:price:IMPORT_PRICE_INVALID',
      '2:price:IMPORT_PRICE_INVALID',
    ]);
  });

  it('never returns an error row among the normalized rows', () => {
    const result = mapRows([
      { row: 2, cells: goodRow('Cut') },
      { row: 3, cells: goodRow('Bad', { price: text('') }) },
    ]);
    expect(result.rows.map((row) => row.row)).toEqual([2]);
    expect(result.rows[0]?.row).toBe(2);
  });
});

// رؤوس الورقة المرتبة على غير الترتيب المرجعي، وخطأ كل صف بترتيب رؤوسها نفسها.
const SHUFFLED_HEADERS = [
  'counts_toward_threshold',
  'commission_value',
  'commission_rule',
  'category',
  'duration_minutes',
  'price',
  'name_ar',
  'name_en',
];

const MIXED_ERRORS = [
  '2:name_en:IMPORT_DUPLICATE_IN_FILE',
  '3:name_en:IMPORT_DUPLICATE_IN_FILE',
  '4:category:IMPORT_CATEGORY_NOT_FOUND',
  '4:duration_minutes:IMPORT_DURATION_INVALID',
];

describe('mixed shuffled headers with duplicates and independent errors across rows', () => {
  it('keeps per-row header order, sheet row order and duplicate diagnostics together', () => {
    const result = mapRows(
      [
        {
          row: 2,
          cells: goodRow('Duo', {
            name_ar: text(' كات '),
            price: text('4'),
            duration_minutes: text('45'),
            category: text('Hair Care'),
            commission_rule: text('  '),
            commission_value: null,
            counts_toward_threshold: bool(true),
          }),
        },
        {
          row: 3,
          cells: goodRow('duo', {
            name_ar: null,
            price: text('6.5'),
            duration_minutes: null,
            category: null,
            commission_rule: text('fixed'),
            commission_value: text('0.250'),
            counts_toward_threshold: text('TRUE'),
          }),
        },
        {
          row: 4,
          cells: goodRow('Solo', {
            name_ar: null,
            price: text('1.000'),
            duration_minutes: numeric('0'),
            category: text('Nails'),
            commission_rule: null,
            commission_value: null,
            counts_toward_threshold: null,
          }),
        },
      ],
      SHUFFLED_HEADERS,
    );
    // أخطاء الصفوف 2 و3 و4 بترتيب الورقة، والتصنيف يسبق المدة حسب ترتيب الأعمدة.
    expect(codes(result.errors)).toEqual(MIXED_ERRORS);
    // الصفان 2 و3 مكرران فيشيلهم الاتنان من الصفوف المطبّعة، والصف 4 غلط في عمودين، فالنتيجة بلا صفوف.
    expect(result.rows).toEqual([]);
    expect(result.keys).toEqual([
      { row: 2, key: 'duo' },
      { row: 3, key: 'duo' },
      { row: 4, key: 'solo' },
    ]);
  });
});
