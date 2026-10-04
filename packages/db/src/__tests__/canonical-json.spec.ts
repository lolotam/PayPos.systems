import { expect, it } from 'vitest';
import { canonicalJson } from '../canonical-json.ts';

it('serializes equal content identically regardless of key order, at every depth', () => {
  const a = { b: 1, a: { d: [2, { y: true, x: null }], c: 'ق' } };
  const b = { a: { c: 'ق', d: [2, { x: null, y: true }] }, b: 1 };
  expect(canonicalJson(a)).toBe(canonicalJson(b));
  expect(canonicalJson(a)).toBe('{"a":{"c":"ق","d":[2,{"x":null,"y":true}]},"b":1}');
  expect(canonicalJson(JSON.parse(canonicalJson(a)))).toBe(canonicalJson(a));
});

it('keeps array order and value differences significant and drops undefined keys like JSON', () => {
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  expect(canonicalJson({ revision: 1 })).not.toBe(canonicalJson({ revision: 2 }));
  expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  expect(canonicalJson(Object.assign(Object.create(null), { b: 2, a: 1 }))).toBe('{"a":1,"b":2}');
});

it.each([
  ['bigint', 1n],
  ['non-finite number', Number.NaN],
  ['function', () => undefined],
  ['date', new Date(0)],
  ['nested undefined array item', [undefined]],
])('refuses a non-JSON %s instead of silently coercing it', (_name, value) => {
  expect(() => canonicalJson(value)).toThrow(TypeError);
});
