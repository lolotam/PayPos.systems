import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { myLeaveAr, myLeaveEn } from './my-leave-catalog.js';
it('supplies Arabic and English own-leave controls and guidance', () => {
  for (const key of Object.keys(myLeaveEn) as (keyof typeof myLeaveEn)[]) {
    expect(t('ar', `myLeave.${key}`)).toBe(myLeaveAr[key]);
    expect(t('en', `myLeave.${key}`)).toBe(myLeaveEn[key]);
    expect(myLeaveAr[key]).toMatch(/[\u0600-\u06ff]/);
  }
});
