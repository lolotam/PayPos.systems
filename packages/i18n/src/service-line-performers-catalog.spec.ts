import { expect, it } from 'vitest';
import { t } from './catalog.js';
import {
  serviceLinePerformersAr,
  serviceLinePerformersEn,
} from './service-line-performers-catalog.js';

it('registers day-list performer-change keys with matching, nonempty ar/en translations', () => {
  expect(Object.keys(serviceLinePerformersAr)).toEqual(Object.keys(serviceLinePerformersEn));
  for (const key of Object.keys(
    serviceLinePerformersEn,
  ) as (keyof typeof serviceLinePerformersEn)[]) {
    expect(t('en', `serviceLinePerformers.${key}`)).toBe(serviceLinePerformersEn[key]);
    expect(t('ar', `serviceLinePerformers.${key}`)).toBe(serviceLinePerformersAr[key]);
    expect(serviceLinePerformersEn[key].trim()).not.toBe('');
    expect(serviceLinePerformersAr[key]).toMatch(/[؀-ۿ]/);
  }
  expect(serviceLinePerformersAr.changed).toBe('اتغيّر المنفّذين');
});
