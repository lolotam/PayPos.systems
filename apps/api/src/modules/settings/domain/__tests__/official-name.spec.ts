import { updateBusinessIdentityNamesInput } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import { normalizeOfficialName, OfficialNameRejected } from '../official-name.ts';

const emoji = '😀';

describe('normalizeOfficialName', () => {
  it('trims surrounding spaces and keeps the name', () => {
    expect(normalizeOfficialName('  صالون لمسة جمال  ')).toBe('صالون لمسة جمال');
    expect(normalizeOfficialName(' Lamsa ')).toBe('Lamsa');
  });

  it('accepts 255 code points, including ones whose UTF-16 length is longer', () => {
    expect(normalizeOfficialName('a'.repeat(255))).toHaveLength(255);
    expect(normalizeOfficialName(emoji.repeat(255))).toBe(emoji.repeat(255));
    expect(normalizeOfficialName(emoji.repeat(128))).toBe(emoji.repeat(128));
  });

  it('refuses a blank name, whitespace only, 256 code points, and NUL', () => {
    for (const raw of ['', ' ', '   ', 'a'.repeat(256), emoji.repeat(256), '\u0000', 'a\u0000b', ' \u0000 ']) {
      expect(() => normalizeOfficialName(raw)).toThrow(OfficialNameRejected);
    }
  });

  it('agrees with the contract on 0, 1, 255, 256 and whitespace', () => {
    expect(agreed('')).toBeNull();
    expect(agreed(' ')).toBeNull();
    expect(agreed('   ')).toBeNull();
    expect(agreed('a')).toBe('a');
    expect(agreed('a'.repeat(255))).toBe('a'.repeat(255));
    expect(agreed('a'.repeat(256))).toBeNull();
    expect(agreed('  a  ')).toBe('a');
    expect(agreed('\u0000')).toBeNull();
    expect(agreed(`a${'\u0000'}b`)).toBeNull();
  });
});

function agreed(raw: string): string | null {
  const parsed = updateBusinessIdentityNamesInput.safeParse({ official_name_en: raw });
  const fromContract = parsed.success ? (parsed.data.official_name_en ?? null) : null;
  let fromDomain: string | null = null;
  try {
    fromDomain = normalizeOfficialName(raw);
  } catch (error) {
    if (!(error instanceof OfficialNameRejected)) throw error;
  }
  expect(fromContract).toBe(fromDomain);
  return fromDomain;
}
