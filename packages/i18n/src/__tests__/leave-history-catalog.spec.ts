import { expect, it } from 'vitest';
import { t } from '../catalog.js';
import { leaveHistoryAr, leaveHistoryEn } from '../leave-history-catalog.js';

it('registers every leave-history label in Arabic and English', () => {
  for (const key of Object.keys(leaveHistoryEn) as (keyof typeof leaveHistoryEn)[]) {
    expect(t('ar', `leaveHistory.${key}`)).toBe(leaveHistoryAr[key]);
    expect(t('en', `leaveHistory.${key}`)).toBe(leaveHistoryEn[key]);
    expect(leaveHistoryAr[key]).toMatch(/[\u0600-\u06ff]/);
  }
  expect(leaveHistoryAr.openTitle).toBe('طلبات جاية ومستنية');
  expect(leaveHistoryAr.coveredElsewhere).toBe('متغطي خارج الفرع');
  expect(leaveHistoryAr.absenceType).toBe('غياب من غير عذر');
  expect(leaveHistoryAr.none).toBe('مفيش');
});
