import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../index.js';

const VALUES: [unknown, string][] = [
  [null, 'null'],
  [true, 'true'],
  [false, 'false'],
  [0, '0'],
  [-12.5, '-12.5'],
  ['Noura', '"Noura"'],
  ['say "hi"', '"say \\"hi\\""'],
  ['نورة', '"نورة"'],
  [{}, '{}'],
  [[], '[]'],
];

const SAME_CONTENT: [unknown, unknown][] = [
  [{ a: 1, b: 2 }, { b: 2, a: 1 }],
  [{ x: { c: 1, b: 2 }, y: 3 }, { y: 3, x: { b: 2, c: 1 } }],
];

describe('canonicalJson: one text for one content', () => {
  it.each(VALUES)('writes %s as %s', (value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });

  it('sorts the keys of an object', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts the keys at every level', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it.each(SAME_CONTENT)('gives the same text to %s and %s', (left, right) => {
    expect(canonicalJson(left)).toBe(canonicalJson(right));
  });

  it('keeps the order of an array', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('drops an undefined member and keeps a null one', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson({ a: undefined })).toBe('{}');
  });

  it('writes a nested value exactly', () => {
    expect(canonicalJson({ z: [1, { y: null, x: 'نورة' }], a: true })).toBe(
      '{"a":true,"z":[1,{"x":"نورة","y":null}]}',
    );
  });
});
