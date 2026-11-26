import { expect, it } from 'vitest';
import { t } from './catalog.js';
import { myAttendanceAr, myAttendanceEn } from './my-attendance-catalog.js';

it('supplies Arabic and English «حضوري» copy for every key', () => {
  for (const key of Object.keys(myAttendanceEn) as (keyof typeof myAttendanceEn)[]) {
    expect(t('ar', `myAttendance.${key}`)).toBe(myAttendanceAr[key]);
    expect(t('en', `myAttendance.${key}`)).toBe(myAttendanceEn[key]);
    expect(myAttendanceAr[key]).toMatch(/[\u0600-\u06ff]/);
    expect(myAttendanceEn[key]).not.toMatch(/[\u0600-\u06ff]/);
  }
});

it('uses the owner-given Arabic words for the title, the open session and the corrected mark', () => {
  expect(myAttendanceAr.title).toBe('حضوري');
  expect(myAttendanceAr.stillClockedIn).toBe('لسه ما بصمتيش خروج');
  expect(myAttendanceAr.missedOut).toBe('خروج ناقص');
  expect(myAttendanceAr.corrected).toBe('اتعدّل');
});
