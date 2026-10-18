import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { serviceLineEditAr, serviceLineEditEn } from './service-line-edit-catalog.js';

it('registers day-list edit keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(serviceLineEditAr)).toEqual(Object.keys(serviceLineEditEn));
  for (const key of Object.keys(serviceLineEditEn) as (keyof typeof serviceLineEditEn)[]) {
    expect(t('en', `serviceLineEdit.${key}`)).toBe(serviceLineEditEn[key]);
    expect(t('ar', `serviceLineEdit.${key}`)).toBe(serviceLineEditAr[key]);
    expect(serviceLineEditEn[key].trim()).not.toBe('');
    expect(serviceLineEditAr[key]).toMatch(/[\u0600-\u06FF]/);
  }
});
