import { expect, it } from 'vitest';
import { formatRemainingMinutes } from '../remaining-minutes.js';

it('localizes remaining minutes and rounds a partial minute without displaying UTC timestamps', () => {
  const now = new Date('2026-10-02T10:00:00Z');
  const end = new Date('2026-10-02T10:07:01Z');
  expect(formatRemainingMinutes(end, now, 'en')).toBe('Session ends in 8 minutes');
  expect(formatRemainingMinutes(end, now, 'ar')).toBe('تنتهي الجلسة خلال 8 دقيقة');
  expect(formatRemainingMinutes(now, end, 'en')).toBe('Session ends in 0 minutes');
});
