import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { serviceLineCancelAr, serviceLineCancelEn } from './service-line-cancel-catalog.js';

it('registers day-list cancel keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(serviceLineCancelAr)).toEqual(Object.keys(serviceLineCancelEn));
  for (const key of Object.keys(serviceLineCancelEn) as (keyof typeof serviceLineCancelEn)[]) {
    expect(t('en', `serviceLineCancel.${key}`)).toBe(serviceLineCancelEn[key]);
    expect(t('ar', `serviceLineCancel.${key}`)).toBe(serviceLineCancelAr[key]);
    expect(serviceLineCancelEn[key].trim()).not.toBe('');
    expect(serviceLineCancelAr[key]).toMatch(/[\u0600-\u06FF]/);
  }
  expect(serviceLineCancelAr.cancelled).toBe('اتلغى');
});
