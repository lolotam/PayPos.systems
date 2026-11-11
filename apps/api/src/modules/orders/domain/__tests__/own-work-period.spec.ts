import { expect, it } from 'vitest';
import { ownWorkPeriodAllowed } from '../own-work-period.ts';

it.each([
  ['2026-01', '2026-01', 2, true],
  ['2025-12', '2026-01', 2, true],
  ['2025-11', '2026-01', 2, false],
  ['2026-02', '2026-01', 2, false],
  ['2025-11', '2026-01', 3, true],
  ['2025-10', '2026-01', 3, false],
  ['2025-02', '2026-01', 12, true],
  ['2025-01', '2026-01', 12, false],
  ['2026-01', '2026-01', 1, true],
  ['2025-12', '2026-01', 1, false],
])('month %s at %s in a %i-month window: %s', (month, current, months, allowed) => {
  expect(ownWorkPeriodAllowed(month, current, months)).toBe(allowed);
});
