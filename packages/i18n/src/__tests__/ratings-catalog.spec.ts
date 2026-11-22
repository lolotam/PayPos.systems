import { describe, expect, it } from 'vitest';

import { t } from '../catalog.js';
import { ratingsAr, ratingsEn } from '../ratings-catalog.js';

describe('ratings catalog', () => {
  it('has the same keys in both languages and no empty text', () => {
    expect(Object.keys(ratingsAr).sort()).toEqual(Object.keys(ratingsEn).sort());
    for (const text of [...Object.values(ratingsAr), ...Object.values(ratingsEn)]) {
      expect(text.trim()).not.toBe('');
    }
  });

  it('keeps Arabic text Arabic and English text free of Arabic letters', () => {
    for (const text of Object.values(ratingsAr)) expect(text).toMatch(/[\u0600-\u06FF]/);
    for (const text of Object.values(ratingsEn)) expect(text).not.toMatch(/[\u0600-\u06FF]/);
  });

  it('resolves the screen title in both languages through the registered section', () => {
    expect(t('en', 'ratings.title')).toBe('Ratings');
    expect(t('ar', 'ratings.title')).toBe(ratingsAr.title);
  });
});
