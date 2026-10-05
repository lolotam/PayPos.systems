import { describe, expect, it } from 'vitest';

import { cardDisplaySuffix, normalizeCardCode, validCardCode } from '../employee-card.ts';

it('never displays the entire code, including the minimum four-character card', () => {
  expect(cardDisplaySuffix('ABCD')).toBe('BCD');
  expect(cardDisplaySuffix('CARD-0001')).toBe('0001');
});

describe('normalizeCardCode', () => {
  it('trims only the edges and keeps the case of a scanner code', () => {
    expect(normalizeCardCode('  A1-b2.C3  ')).toBe('A1-b2.C3');
    expect(normalizeCardCode('card-0001')).toBe('card-0001');
  });
});

describe('validCardCode', () => {
  it('accepts printable-ASCII codes of 4 to 64 characters', () => {
    expect(validCardCode('ABCD')).toBe(true);
    expect(validCardCode('0192-0000-7000::card')).toBe(true);
    expect(validCardCode('x'.repeat(64))).toBe(true);
  });
  it('rejects short, long, empty or non-printable codes', () => {
    expect(validCardCode('abc')).toBe(false);
    expect(validCardCode('x'.repeat(65))).toBe(false);
    expect(validCardCode('has space')).toBe(false);
    expect(validCardCode('tab\there')).toBe(false);
    expect(validCardCode('عربي')).toBe(false);
  });
});
