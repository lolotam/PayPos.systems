import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { commissionOverridesAr, commissionOverridesEn } from './commission-override-catalog.js';

it('registers the special commission keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(commissionOverridesAr)).toEqual(Object.keys(commissionOverridesEn));
  for (const key of Object.keys(commissionOverridesEn) as (keyof typeof commissionOverridesEn)[]) {
    expect(t('en', `commissionOverrides.${key}`)).toBe(commissionOverridesEn[key]);
    expect(t('ar', `commissionOverrides.${key}`)).toBe(commissionOverridesAr[key]);
    expect(commissionOverridesEn[key].trim()).not.toBe('');
    expect(commissionOverridesAr[key]).toMatch(/[\u0600-\u06FF]/);
  }
});
