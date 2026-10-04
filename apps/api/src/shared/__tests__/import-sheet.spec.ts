import { describe, expect, it } from 'vitest';

import {
  cellText,
  excelSerialToIsoDate,
  isoDateFromText,
  readSheet,
} from '../import/import-sheet.ts';

const headers = ['a', 'b'] as const;

describe('readSheet', () => {
  it('accepts the exact header set in any order and numbers data rows from 2', () => {
    const result = readSheet([['b', 'a'], [2, 1], [4, 3]], headers);
    expect(result).toEqual({
      headers: ['b', 'a'],
      rows: [
        { row: 2, cells: [2, 1] },
        { row: 3, cells: [4, 3] },
      ],
    });
  });

  it('rejects missing, extra and duplicate headers', () => {
    expect(readSheet([['a']], headers)).toBe('IMPORT_HEADER_INVALID');
    expect(readSheet([['a', 'b', 'c']], headers)).toBe('IMPORT_HEADER_INVALID');
    expect(readSheet([['a', 'a']], headers)).toBe('IMPORT_HEADER_INVALID');
    expect(readSheet([], headers)).toBe('IMPORT_HEADER_INVALID');
  });

  it('skips fully empty rows but keeps their position number', () => {
    const result = readSheet([['a', 'b'], [null, ''], [1, 2], ['', ''], [3, 4]], headers);
    expect(result).not.toBe('IMPORT_HEADER_INVALID');
    expect(typeof result === 'string' ? [] : result.rows.map((row) => row.row)).toEqual([3, 5]);
  });

  it('refuses 501 data rows and accepts exactly 500', () => {
    const row = [1, 2];
    const many = (n: number) => Array.from({ length: n + 1 }, (_, i) => (i === 0 ? ['a', 'b'] : row));
    expect(readSheet(many(500), headers) !== 'IMPORT_ROW_LIMIT_EXCEEDED').toBe(true);
    expect(readSheet(many(501), headers)).toBe('IMPORT_ROW_LIMIT_EXCEEDED');
  });
});

describe('cell coercions', () => {
  it('trims text and treats blank as null', () => {
    expect(cellText('  x ')).toBe('x');
    expect(cellText('')).toBeNull();
    expect(cellText(null)).toBeNull();
  });

  it('converts Excel serial dates and rejects fractional or out-of-range serials', () => {
    expect(excelSerialToIsoDate(1)).toBe('1900-01-01');
    expect(excelSerialToIsoDate(45000)).toBe('2023-03-15');
    expect(excelSerialToIsoDate(45000.5)).toBeNull();
    expect(excelSerialToIsoDate(0)).toBeNull();
    expect(excelSerialToIsoDate(2_958_466)).toBeNull();
  });

  it('accepts only real ISO dates', () => {
    expect(isoDateFromText('2026-02-28')).toBe('2026-02-28');
    expect(isoDateFromText('2026-02-30')).toBeNull();
    expect(isoDateFromText('1/2/2026')).toBeNull();
  });
});
