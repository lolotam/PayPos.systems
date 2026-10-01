import { describe, expect, it } from 'vitest';

import { displayName } from './display-name';

const ARABIC_NAME = 'فرع الشرق';
const ENGLISH_NAME = 'Sharq Branch';

describe('displayName', () => {
  it('returns Arabic name when present for Arabic locale', () => {
    const item = { name_ar: ARABIC_NAME, name_en: ENGLISH_NAME };
    expect(displayName(item, 'ar')).toBe(ARABIC_NAME);
  });

  it('falls back to name_en when name_ar is null or empty whitespace for Arabic locale', () => {
    expect(displayName({ name_ar: null, name_en: ENGLISH_NAME }, 'ar')).toBe(ENGLISH_NAME);
    expect(displayName({ name_ar: '   ', name_en: ENGLISH_NAME }, 'ar')).toBe(ENGLISH_NAME);
  });

  it('returns English name for English locale regardless of Arabic name presence', () => {
    expect(displayName({ name_ar: ARABIC_NAME, name_en: ENGLISH_NAME }, 'en')).toBe(ENGLISH_NAME);
    expect(displayName({ name_ar: null, name_en: ENGLISH_NAME }, 'en')).toBe(ENGLISH_NAME);
  });
});
