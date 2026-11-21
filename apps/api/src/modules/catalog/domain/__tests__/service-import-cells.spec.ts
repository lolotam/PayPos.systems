import { describe, expect, it } from 'vitest';

import {
  parseServiceImportBooleanCell,
  parseServiceImportCategoryCell,
  parseServiceImportDurationCell,
  parseServiceImportNameCell,
  type ServiceImportCategoryResolver,
} from '../service-import-cells.ts';
import type { ServiceImportTaggedCell } from '../service-import-price-cell.ts';

const text = (value: string): ServiceImportTaggedCell => ({ kind: 'text', text: value });
const numeric = (value: string): ServiceImportTaggedCell => ({
  kind: 'numeric',
  text: value,
  percentFormat: false,
});
const bool = (value: boolean): ServiceImportTaggedCell => ({ kind: 'boolean', value });
const unrepresentable = (display: string): ServiceImportTaggedCell => ({
  kind: 'numeric-unrepresentable',
  display,
});
const errorCell = (): ServiceImportTaggedCell => ({ kind: 'error' });

const HAIR = '018f0000-0000-7000-8000-000000000001';
const MAKEUP = '018f0000-0000-7000-8000-000000000002';

/**
 * محلّل اختبار بخريطة نصّ-بحث حرفي، بنفس عقد ما يبنيه 32b-2 من قاعدة البيانات بلا تطبيع جافاسكربت.
 *
 * @param lookup خريطة النص الحرفي إلى التصنيف المحلول
 * @returns محلّل التصنيف القائم على الخريطة
 */
const mapResolver =
  (lookup: ReadonlyMap<string, { id: string; nameEn: string }>): ServiceImportCategoryResolver =>
  (lookupText) =>
    lookup.get(lookupText) ?? null;

const RESOLVER = mapResolver(
  new Map([
    ['Hair Care', { id: HAIR, nameEn: 'Hair Care' }],
    ['مكياج', { id: MAKEUP, nameEn: 'مكياج' }],
    ['Cafe\u0301 Latte', { id: MAKEUP, nameEn: 'Cafe\u0301 Latte' }],
  ]),
);

describe('name cells (A-5 name_en/name_ar)', () => {
  it('requires name_en and treats a blank or absent cell as required-cell', () => {
    expect(parseServiceImportNameCell(null, true)).toEqual({ ok: false, code: 'IMPORT_REQUIRED_CELL' });
    expect(parseServiceImportNameCell(text('   '), true)).toEqual({
      ok: false,
      code: 'IMPORT_REQUIRED_CELL',
    });
    expect(parseServiceImportNameCell(text('  '), true).ok).toBe(false);
  });

  it('accepts a trimmed name_en through validateServiceNameEn', () => {
    expect(parseServiceImportNameCell(text('  Hair Cut '), true)).toEqual({
      ok: true,
      value: 'Hair Cut',
    });
  });

  it('refuses a numeric name_en cell per this delivery default (T-2 numeric text is a name)', () => {
    expect(parseServiceImportNameCell(numeric('100'), true)).toEqual({ ok: true, value: '100' });
    expect(parseServiceImportNameCell(unrepresentable('1e+21'), true)).toEqual({
      ok: false,
      code: 'IMPORT_NAME_INVALID',
    });
    expect(parseServiceImportNameCell(bool(true), true)).toEqual({
      ok: false,
      code: 'IMPORT_NAME_INVALID',
    });
    expect(parseServiceImportNameCell(errorCell(), true)).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });

  it('reads an absent or empty name_ar as no Arabic name and a bad one as invalid', () => {
    expect(parseServiceImportNameCell(null, false)).toEqual({ ok: true, value: null });
    expect(parseServiceImportNameCell(text(' '), false)).toEqual({ ok: true, value: null });
    expect(parseServiceImportNameCell(text(' قص شعر '), false)).toEqual({
      ok: true,
      value: 'قص شعر',
    });
    // نص الخلية الرقمية هو الاسم نفسه (T-2)؛ الأرقام العربية الحديثة نصّاً اسم مقبول.
    expect(parseServiceImportNameCell(text('٣'), false)).toEqual({ ok: true, value: '٣' });
    expect(parseServiceImportNameCell(errorCell(), false)).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });

  it('refuses a name over 255 characters through the shared validator', () => {
    expect(parseServiceImportNameCell(text('a'.repeat(256)), true)).toEqual({
      ok: false,
      code: 'IMPORT_NAME_INVALID',
    });
    expect(parseServiceImportNameCell(text('a'.repeat(255)), true).ok).toBe(true);
  });

  it('refuses a name over 255 characters through the shared validator', () => {
    expect(parseServiceImportNameCell(text('a'.repeat(256)), true)).toEqual({
      ok: false,
      code: 'IMPORT_NAME_INVALID',
    });
    expect(parseServiceImportNameCell(text('a'.repeat(255)), true).ok).toBe(true);
  });
});

describe('duration cells (A-5 duration_minutes, T-3 leading zeroes)', () => {
  it.each([
    ['120', 120],
    ['090', 90],
    ['1', 1],
    ['600', 600],
  ])('accepts the text %s as %i minutes', (input, expected) => {
    expect(parseServiceImportDurationCell(text(input))).toEqual({ ok: true, value: expected });
  });

  it('accepts a numeric cell through its decimal text (1e2 arrives as 100)', () => {
    expect(parseServiceImportDurationCell(numeric('100'))).toEqual({ ok: true, value: 100 });
    expect(parseServiceImportDurationCell(numeric('45'))).toEqual({ ok: true, value: 45 });
  });

  it.each([
    ['0'],
    ['601'],
    ['7.5'],
    ['-5'],
    ['1e2'],
    ['٣٠'],
    ['60.0.1'],
    ['12 minutes'],
  ])('refuses the duration text %s', (input) => {
    expect(parseServiceImportDurationCell(text(input))).toEqual({
      ok: false,
      code: 'IMPORT_DURATION_INVALID',
    });
  });

  it('refuses unrepresentable numbers, booleans and error cells', () => {
    expect(parseServiceImportDurationCell(unrepresentable('1e+21'))).toEqual({
      ok: false,
      code: 'IMPORT_DURATION_INVALID',
    });
    expect(parseServiceImportDurationCell(bool(true))).toEqual({
      ok: false,
      code: 'IMPORT_DURATION_INVALID',
    });
    expect(parseServiceImportDurationCell(errorCell())).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });

  it('reads an absent or blank duration as no duration', () => {
    expect(parseServiceImportDurationCell(null)).toEqual({ ok: true, value: null });
    expect(parseServiceImportDurationCell(text('  '))).toEqual({ ok: true, value: null });
  });
});

describe('category resolution via the caller resolver (A-5/A-11)', () => {
  it('resolves the exact submitted lookup text and preserves UUID and display name', () => {
    expect(parseServiceImportCategoryCell(text('Hair Care'), RESOLVER)).toEqual({
      ok: true,
      value: { id: HAIR, nameEn: 'Hair Care' },
    });
    expect(parseServiceImportCategoryCell(text('مكياج'), RESOLVER)).toEqual({
      ok: true,
      value: { id: MAKEUP, nameEn: 'مكياج' },
    });
  });

  it('sends the trimmed submitted text verbatim and lets the resolver decide', () => {
    // المحوّل ما بيطبّعش ولا بيمسح أول مطابقة: بيرسل النص المشذب حرفياً، والقرار للمحلّل.
    const seen: string[] = [];
    const spy: ServiceImportCategoryResolver = (lookupText) => {
      seen.push(lookupText);
      return null;
    };
    expect(parseServiceImportCategoryCell(text('  Hair  Care '), spy)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(seen).toEqual(['Hair  Care']);
  });

  it('keeps distinct non-ASCII spellings distinct when the caller maps them separately', () => {
    const distinct = mapResolver(
      new Map([
        ['Café Latte', { id: HAIR, nameEn: 'Café Latte' }],
        ['Cafe\u0301 Latte', { id: MAKEUP, nameEn: 'Cafe\u0301 Latte' }],
      ]),
    );
    expect(parseServiceImportCategoryCell(text('Café Latte'), distinct)).toEqual({
      ok: true,
      value: { id: HAIR, nameEn: 'Café Latte' },
    });
    expect(parseServiceImportCategoryCell(text('Cafe\u0301 Latte'), distinct)).toEqual({
      ok: true,
      value: { id: MAKEUP, nameEn: 'Cafe\u0301 Latte' },
    });
  });

  it('refuses a spelling that is not in the caller map at all', () => {
    // في RESOLVER مفتاح وحيد للإملاء المنفصل، فالمركّب الغايب يرفض غياباً.
    expect(parseServiceImportCategoryCell(text('Café Latte'), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
  });
});

describe('category refusals (A-5)', () => {
  it('refuses an unknown name and a numeric cell that matches nothing', () => {
    expect(parseServiceImportCategoryCell(text('Nails'), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(numeric('100'), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
  });

  it('refuses booleans, unrepresentable numbers and error cells', () => {
    expect(parseServiceImportCategoryCell(bool(true), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(unrepresentable('1e+21'), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(errorCell(), RESOLVER)).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });

  it('reads an absent or blank category as no category', () => {
    expect(parseServiceImportCategoryCell(null, RESOLVER)).toEqual({ ok: true, value: null });
    expect(parseServiceImportCategoryCell(text(' '), RESOLVER)).toEqual({ ok: true, value: null });
  });
});

describe('counts_toward_threshold cells (A-5, SR-005)', () => {
  it.each([
    ['true', true],
    ['True', true],
    ['YES', true],
    ['نعم', true],
    ['false', false],
    ['FALSE', false],
    ['No', false],
    ['لا', false],
  ])('accepts the text %s as %s', (input, expected) => {
    expect(parseServiceImportBooleanCell(text(input))).toEqual({ ok: true, value: expected });
  });

  it('accepts a boolean cell with its own value and a blank as true', () => {
    expect(parseServiceImportBooleanCell(bool(false))).toEqual({ ok: true, value: false });
    expect(parseServiceImportBooleanCell(bool(true))).toEqual({ ok: true, value: true });
    expect(parseServiceImportBooleanCell(null)).toEqual({ ok: true, value: true });
    expect(parseServiceImportBooleanCell(text(' '))).toEqual({ ok: true, value: true });
  });

  it('refuses unknown words, numbers, unrepresentable values and error cells', () => {
    expect(parseServiceImportBooleanCell(text('maybe'))).toEqual({
      ok: false,
      code: 'IMPORT_BOOLEAN_INVALID',
    });
    expect(parseServiceImportBooleanCell(numeric('1'))).toEqual({
      ok: false,
      code: 'IMPORT_BOOLEAN_INVALID',
    });
    expect(parseServiceImportBooleanCell(unrepresentable('1e+21'))).toEqual({
      ok: false,
      code: 'IMPORT_BOOLEAN_INVALID',
    });
    expect(parseServiceImportBooleanCell(errorCell())).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });
});
