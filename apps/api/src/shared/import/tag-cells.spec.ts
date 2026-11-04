import { describe, expect, it } from 'vitest';

import { INVALID_CELL, type ImportMatrix } from './import-sheet.ts';
import { tagCells } from './tag-cells.ts';

describe('tagCells reader boundary', () => {
  it('keeps blanks, literal text, booleans and the reader error distinct', () => {
    expect(tagCells([[null, '', '  نص  ', '#REF!', true, false, INVALID_CELL]])).toEqual([
      [
        null,
        { kind: 'text', text: '' },
        { kind: 'text', text: '  نص  ' },
        { kind: 'text', text: '#REF!' },
        { kind: 'boolean', value: true },
        { kind: 'boolean', value: false },
        { kind: 'error' },
      ],
    ]);
  });

  it.each([
    [0.57, '0.57'],
    [2.3, '2.3'],
    [0, '0'],
    [-0, '0'],
    [-12.5, '-12.5'],
    [1e2, '100'],
    [1e-6, '0.000001'],
    [0.00000123456789012, '0.00000123456789012'],
    [-0.00000123456789012, '-0.00000123456789012'],
    [123456789012345, '123456789012345'],
    [1.23456789012345, '1.23456789012345'],
    [12.5555, '12.5555'],
  ])('keeps the shortest text of %s without scaling or rounding', (value, text) => {
    expect(tagCells([[value]])).toEqual([[{ kind: 'numeric', text, percentFormat: false }]]);
  });

  it.each([
    [1234567890123456, '1234567890123456'],
    [-1234567890123456, '-1234567890123456'],
    [1.234567890123456, '1.234567890123456'],
    [0.000001234567890123456, '0.000001234567890123456'],
    [1e21, '1e+21'],
    [-1e21, '-1e+21'],
    [1e-7, '1e-7'],
    [Number.MIN_VALUE, '5e-324'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
  ])('rejects the numeric representation of %s with safe display text', (value, display) => {
    expect(tagCells([[value]])).toEqual([[{ kind: 'numeric-unrepresentable', display }]]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'tags nonfinite %s as error',
    (value) => {
      expect(tagCells([[value]])).toEqual([[{ kind: 'error' }]]);
    },
  );
});

describe('tagCells unsupported values and formats', () => {
  it.each([
    { value: {} },
    { value: { error: '#REF!' } },
    { value: { formula: '1/0', result: INVALID_CELL } },
    { value: [] },
    { value: 1n },
    { value: undefined },
  ])('refuses unsupported raw value %o instead of supplying a blank', ({ value }) => {
    const matrix = [[value]] as unknown as ImportMatrix;
    expect(tagCells(matrix)).toEqual([[{ kind: 'error' }]]);
  });

  it('keeps already flattened formula errors and numeric results', () => {
    expect(tagCells([[INVALID_CELL, 0.2]], [[null, '0%']])).toEqual([
      [{ kind: 'error' }, { kind: 'numeric', text: '0.2', percentFormat: true }],
    ]);
  });
});

describe('tagCells first-section percentage formats', () => {
  it.each([
    ['0%', true],
    ['0.00%', true],
    ['0%;-0%', true],
    ['0.0"%"', false],
    ['0\\%', false],
    ['General', false],
    ['0.000', false],
    ['0;0%', false],
    ['0;";"0%', false],
    ['0";"%', true],
    ['0";%"', false],
    ['0"quoted%";0%', false],
    ['0_%', false],
    ['0*%', false],
    ['0_%%', true],
    ['0*%%', true],
    ['0\\"%', true],
    ['0\\\\%', true],
    ['0"a\\";%"', false],
    ['0"a\\";"%', true],
    ['0"a\\\\"%', true],
    ['', false],
    [null, false],
    [undefined, false],
  ])('classifies first-section format %o as %s', (format, percentFormat) => {
    expect(tagCells([[0.125]], [[format]])).toEqual([
      [{ kind: 'numeric', text: '0.125', percentFormat }],
    ]);
  });
});

describe('tagCells coordinates and missing formats', () => {
  it('aligns a sparse format grid by coordinates and ignores excess formats', () => {
    const row = Object.assign(Array<string | undefined>(2), { 1: '0%' });
    const formats = Object.assign(Array<(string | null | undefined)[] | undefined>(3), {
      0: row,
      2: [null, '0.00%', '0%'],
    });
    expect(tagCells([[1, 2, 3], [4], [5, 6]], formats)).toEqual([
      [
        { kind: 'numeric', text: '1', percentFormat: false },
        { kind: 'numeric', text: '2', percentFormat: true },
        { kind: 'numeric', text: '3', percentFormat: false },
      ],
      [{ kind: 'numeric', text: '4', percentFormat: false }],
      [
        { kind: 'numeric', text: '5', percentFormat: false },
        { kind: 'numeric', text: '6', percentFormat: true },
      ],
    ]);
  });

  it.each([
    { formats: undefined },
    { formats: null },
    { formats: [] },
    { formats: [null] },
    { formats: [undefined] },
    { formats: [[]] },
  ])('treats a missing format as unformatted: %o', ({ formats }) => {
    expect(tagCells([[0.2]], formats)).toEqual([
      [{ kind: 'numeric', text: '0.2', percentFormat: false }],
    ]);
  });

  it('does not interpret format strings for text, booleans, blanks or errors', () => {
    expect(tagCells([['20%', false, null, INVALID_CELL]], [['0%', '0%', '0%', '0%']])).toEqual([
      [{ kind: 'text', text: '20%' }, { kind: 'boolean', value: false }, null, { kind: 'error' }],
    ]);
  });
});

describe('tagCells immutability and payloads', () => {
  it('copies frozen rows and source row metadata without changing either input', () => {
    const sourceRows = Object.freeze([1, 4, 19]);
    const matrix = Object.freeze(
      Object.assign(
        [
          Object.freeze(['Header', null]),
          Object.freeze([]),
          Object.freeze([0.57, INVALID_CELL, false]),
        ],
        { sourceRows },
      ),
    );
    const formats = Object.freeze([
      Object.freeze([null, null]),
      Object.freeze([]),
      Object.freeze(['0%', null, null]),
    ]);
    const tagged = tagCells(matrix, formats);
    expect(tagged.map((row) => row.length)).toEqual([2, 0, 3]);
    expect(tagged.sourceRows).toEqual([1, 4, 19]);
    expect(tagged.sourceRows).not.toBe(sourceRows);
    expect(tagged).not.toBe(matrix);
    tagged.forEach((row, index) => expect(row).not.toBe(matrix[index]));
    expect(matrix[2]).toEqual([0.57, INVALID_CELL, false]);
    expect(formats[2]).toEqual(['0%', null, null]);
    expect(tagged[2]).toEqual([
      { kind: 'numeric', text: '0.57', percentFormat: true },
      { kind: 'error' },
      { kind: 'boolean', value: false },
    ]);
  });

  it('preserves empty dimensions and omits absent row metadata', () => {
    expect(tagCells([])).toEqual([]);
    const tagged = tagCells([[], [null], []]);
    expect(tagged).toEqual([[], [null], []]);
    expect(Object.hasOwn(tagged, 'sourceRows')).toBe(false);
  });

  it('never exposes a number in any tagged cell payload', () => {
    const tagged = tagCells([[null, 'text', true, 0.57, 1e21, INVALID_CELL, Number.NaN]]);
    for (const row of tagged) {
      for (const cell of row) {
        if (cell === null) continue;
        for (const value of Object.values(cell)) expect(typeof value).not.toBe('number');
      }
    }
    expect(tagged[0]?.map((cell) => cell?.kind ?? null)).toEqual([
      null,
      'text',
      'boolean',
      'numeric',
      'numeric-unrepresentable',
      'error',
      'error',
    ]);
  });
});
