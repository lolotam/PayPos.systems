import { describe, expect, it } from 'vitest';

import { formatDate, isTimeZone, localDate } from '../dates.js';

// 21:30 UTC on the 23rd is already the 24th in Kuwait (UTC+3): the branch's day, not UTC's, is the one that counts.
const LATE_EVENING_UTC = new Date('2026-09-23T21:30:00.000Z');

describe('dates in the branch time zone', () => {
  it("the local day is the branch's, not UTC's", () => {
    expect(localDate(LATE_EVENING_UTC, 'Asia/Kuwait')).toBe('2026-09-24');
    expect(localDate(LATE_EVENING_UTC, 'UTC')).toBe('2026-09-23');
    expect(localDate(LATE_EVENING_UTC, 'America/New_York')).toBe('2026-09-23');
  });

  it('formats Gregorian and Hijri (Umm al-Qura) in both languages, with Latin digits', () => {
    const at = (locale: 'ar' | 'en', calendar: 'gregorian' | 'hijri') =>
      formatDate(LATE_EVENING_UTC, { locale, calendar, timeZone: 'Asia/Kuwait' });
    expect(at('en', 'gregorian')).toBe('September 24, 2026');
    expect(at('en', 'hijri')).toContain('1448');
    expect(at('ar', 'gregorian')).toMatch(/^24 .+ 2026$/);
    expect(at('ar', 'hijri')).toMatch(/^13 .+ 1448/);
  });

  it('accepts IANA time zones and refuses anything else', () => {
    for (const zone of ['Asia/Kuwait', 'Asia/Riyadh', 'UTC']) expect(isTimeZone(zone)).toBe(true);
    for (const zone of ['', 'Kuwait/City', 'GMT+99', 'asia kuwait']) {
      expect(isTimeZone(zone)).toBe(false);
    }
  });
});
