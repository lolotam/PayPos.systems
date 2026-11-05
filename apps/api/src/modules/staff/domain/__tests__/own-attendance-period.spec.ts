import { expect, it } from 'vitest';
import { ownAttendancePeriodAllowed } from '../own-attendance-period.ts';
it.each([
  ['2026-01', '2026-01', 1, true],
  ['2025-12', '2026-01', 1, false],
  ['2025-12', '2026-01', 2, true],
  ['2025-11', '2026-01', 2, false],
  ['2026-02', '2026-01', 12, false],
  ['2025-02', '2026-01', 12, true],
  ['2025-01', '2026-01', 12, false],
])('calendar month %s at %s with window %i: %s', (month, current, window, allowed) => {
  expect(ownAttendancePeriodAllowed(month, current, window)).toBe(allowed);
});
