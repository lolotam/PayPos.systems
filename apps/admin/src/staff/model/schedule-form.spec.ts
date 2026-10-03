import { expect, it } from 'vitest';
import { branchCivilDate, initialScheduleWeek } from './schedule-form';
it('initialises the Saturday week using the branch timezone at UTC and week boundaries', () => {
  const now = new Date('2026-10-02T22:00:00Z');
  expect(branchCivilDate('Asia/Kuwait', now)).toBe('2026-10-03');
  expect(initialScheduleWeek('Asia/Kuwait', now)).toBe('2026-10-03');
  expect(initialScheduleWeek('America/New_York', now)).toBe('2026-09-26');
  expect(initialScheduleWeek('Asia/Kuwait', new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-26');
});
