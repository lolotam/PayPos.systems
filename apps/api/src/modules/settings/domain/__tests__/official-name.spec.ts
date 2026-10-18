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

  it('refuses a blank name, whitespace only, and 256 code points', () => {
    for (const raw of ['', ' ', '   ', 'a'.repeat(256), emoji.repeat(256)]) {
      expect(() => normalizeOfficialName(raw)).toThrow(OfficialNameRejected);
    }
  });
});
