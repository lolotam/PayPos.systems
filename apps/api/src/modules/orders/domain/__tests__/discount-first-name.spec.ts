import { describe, expect, it } from 'vitest';
import { firstName } from '../discount-first-name.ts';

const CASES: [string, string, string][] = [
  ['one word', 'Noura', 'Noura'],
  ['several words', 'Noura Ahmed', 'Noura'],
  ['a tab between the words', 'Noura\tAhmed', 'Noura'],
  ['a new line between the words', 'Noura\nAhmed', 'Noura'],
  ['a non-breaking space between the words', 'Noura\u00a0Ahmed', 'Noura'],
  ['another Zs space between the words', 'Noura\u2003Ahmed', 'Noura'],
  ['a byte order mark before the words', '\ufeffNoura Ahmed', 'Noura'],
  ['leading and trailing whitespace', '  Noura Ahmed  ', 'Noura'],
  ['a mixed run of whitespace', ' Noura \t \u00a0 Ahmed ', 'Noura'],
  ['a two-word Arabic name', 'نورة أحمد', 'نورة'],
  ['an Arabic name with a tab', 'نورة\tأحمد', 'نورة'],
  ['the empty string', '', ''],
];

describe('the first name cut of a label', () => {
  it.each(CASES)('cuts %s', (_label, name, expected) => {
    expect(firstName(name)).toBe(expected);
  });

  it('returns a name with no word at all unchanged', () => {
    expect(firstName('   ')).toBe('   ');
    expect(firstName('\u00a0\ufeff\t')).toBe('\u00a0\ufeff\t');
  });
});
