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
