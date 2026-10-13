import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { serviceSessionsAr, serviceSessionsEn } from './service-session-catalog.js';

it('registers only the customer field keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(serviceSessionsAr)).toEqual(Object.keys(serviceSessionsEn));
  for (const key of Object.keys(serviceSessionsEn) as (keyof typeof serviceSessionsEn)[]) {
    expect(t('en', `serviceSessions.${key}`)).toBe(serviceSessionsEn[key]);
    expect(t('ar', `serviceSessions.${key}`)).toBe(serviceSessionsAr[key]);
    expect(serviceSessionsEn[key].trim()).not.toBe('');
    expect(serviceSessionsAr[key]).toMatch(/[\u0600-\u06FF]/);
  }
});
