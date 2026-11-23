import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { myWorkAr, myWorkEn } from './my-work-catalog.js';

it('supplies Arabic and English «شغلي» copy for every key', () => {
  for (const key of Object.keys(myWorkEn) as (keyof typeof myWorkEn)[]) {
    expect(t('ar', `myWork.${key}`)).toBe(myWorkAr[key]);
    expect(t('en', `myWork.${key}`)).toBe(myWorkEn[key]);
    expect(myWorkAr[key]).toMatch(/[\u0600-\u06ff]/);
    expect(myWorkEn[key]).not.toMatch(/[\u0600-\u06ff]/);
  }
});

it('uses the owner-given Arabic words for the title and the cancelled mark', () => {
  expect(myWorkAr.title).toBe('شغلي');
  expect(myWorkAr.cancelled).toBe('اتلغت');
  expect(myWorkAr.late).toBe('متأخرة');
});
