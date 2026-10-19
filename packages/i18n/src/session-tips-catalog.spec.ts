import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { sessionTipsAr, sessionTipsEn } from './session-tips-catalog.js';

it('registers reception tip keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(sessionTipsAr)).toEqual(Object.keys(sessionTipsEn));
  for (const key of Object.keys(sessionTipsEn) as (keyof typeof sessionTipsEn)[]) {
    expect(t('en', `sessionTips.${key}`)).toBe(sessionTipsEn[key]);
    expect(t('ar', `sessionTips.${key}`)).toBe(sessionTipsAr[key]);
    expect(sessionTipsEn[key].trim()).not.toBe('');
    expect(sessionTipsAr[key]).toMatch(/[\u0600-\u06FF]/);
  }
});
