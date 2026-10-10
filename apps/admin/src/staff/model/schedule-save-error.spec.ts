import { expect, it } from 'vitest';
import { scheduleSaveMessage } from './schedule-save-error';

const envelope = { message_ar: 'مرفوض', message_en: 'Refused' };
it('names the limit and the refused dates for the day-limit error', () => {
  const error = {
    ...envelope,
    code: 'SCHEDULE_DAY_LIMIT_EXCEEDED',
    details: { max_shifts_per_day: 3, working_dates: ['2026-10-15', '2026-10-16'] },
  };
  expect(scheduleSaveMessage(error, 'en')).toBe(
    'Refused — Limit 3 shifts per day: 2026-10-15, 2026-10-16',
  );
  expect(scheduleSaveMessage(error, 'ar')).toContain('3');
});
it('keeps the envelope message for other errors', () =>
  expect(scheduleSaveMessage({ ...envelope, code: 'SCHEDULE_SHIFT_OVERLAP' }, 'en')).toBe(
    'Refused',
  ));
it('names the refused shift by its day and start for the break error', () => {
  const error = {
    ...envelope,
    code: 'SCHEDULE_BREAK_INVALID',
    details: { day: 2, start: '09:00' },
  };
  expect(scheduleSaveMessage(error, 'en')).toBe('Refused — Shift on Monday starting 09:00');
  expect(scheduleSaveMessage(error, 'ar')).toBe('مرفوض — وردية يوم الاثنين اللي بتبدأ 09:00');
  expect(scheduleSaveMessage({ ...error, details: { day: 9, start: '09:00' } }, 'en')).toBe(
    'Refused',
  );
});
