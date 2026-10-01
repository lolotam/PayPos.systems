import { describe, expect, it } from 'vitest';

import { parseLocale } from './parse-locale';

describe('parseLocale', () => {
  it('accepts only ar and en, defaulting everything else to ar', () => {
    expect(parseLocale('ar')).toBe('ar');
    expect(parseLocale('en')).toBe('en');

    expect(parseLocale(undefined)).toBe('ar');
    expect(parseLocale(null)).toBe('ar');
    expect(parseLocale('')).toBe('ar');
    expect(parseLocale('fr')).toBe('ar');
    expect(parseLocale('en-US')).toBe('ar');
    expect(parseLocale('ar-KW')).toBe('ar');
  });
});
