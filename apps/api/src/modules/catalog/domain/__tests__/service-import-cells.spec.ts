import { describe, expect, it } from 'vitest';

import {
  parseServiceImportBooleanCell,
  parseServiceImportCategoryCell,
  parseServiceImportDurationCell,
  parseServiceImportNameCell,
  type ServiceImportOpenCategory,
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

const HAIR: ServiceImportOpenCategory = {
  id: '018f0000-0000-7000-8000-000000000001',
  name_en: 'Hair Care',
};
const MAKEUP: ServiceImportOpenCategory = {
  id: '018f0000-0000-7000-8000-000000000002',
  name_en: 'مكياج',
};
const CATEGORIES: readonly ServiceImportOpenCategory[] = [HAIR, MAKEUP];

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

describe('category cells (A-5 category)', () => {
  it('matches the exact stored English name', () => {
    expect(parseServiceImportCategoryCell(text('Hair Care'), CATEGORIES)).toEqual({
      ok: true,
      value: { id: HAIR.id, nameEn: 'Hair Care' },
    });
  });

  it('matches a name differing in case and inner whitespace through the shared key', () => {
    expect(parseServiceImportCategoryCell(text('  hair  care '), CATEGORIES)).toEqual({
      ok: true,
      value: { id: HAIR.id, nameEn: 'Hair Care' },
    });
  });

  it('matches an Arabic-only category name', () => {
    expect(parseServiceImportCategoryCell(text('مكياج'), CATEGORIES)).toEqual({
      ok: true,
      value: { id: MAKEUP.id, nameEn: 'مكياج' },
    });
  });

  it('refuses an unknown name and a numeric cell that matches nothing', () => {
    expect(parseServiceImportCategoryCell(text('Nails'), CATEGORIES)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(numeric('100'), CATEGORIES)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
  });

  it('refuses booleans, unrepresentable numbers and error cells', () => {
    expect(parseServiceImportCategoryCell(bool(true), CATEGORIES)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(unrepresentable('1e+21'), CATEGORIES)).toEqual({
      ok: false,
      code: 'IMPORT_CATEGORY_NOT_FOUND',
    });
    expect(parseServiceImportCategoryCell(errorCell(), CATEGORIES)).toEqual({
      ok: false,
      code: 'IMPORT_CELL_INVALID',
    });
  });

  it('reads an absent or blank category as no category', () => {
    expect(parseServiceImportCategoryCell(null, CATEGORIES)).toEqual({ ok: true, value: null });
    expect(parseServiceImportCategoryCell(text(' '), CATEGORIES)).toEqual({ ok: true, value: null });
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
