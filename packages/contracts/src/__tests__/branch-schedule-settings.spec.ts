import { expect, it } from 'vitest';
import {
  branchScheduleSettings,
  scheduleSettings,
  setScheduleSettingsInput,
} from '../staff/schedule-settings.js';
const branch_id = '01920000-0000-7000-8000-000000000101';
it.each(['branch', 'business', 'default'])(
  'accepts source %s and includes active branches',
  (source) => {
    const branch = { branch_id, max_shifts_per_day: 3, source, updated_at: null };
    expect(branchScheduleSettings.parse(branch)).toEqual(branch);
    expect(
      scheduleSettings.parse({
        business_id: branch_id,
        max_shifts_per_day: 3,
        is_default: true,
        updated_at: null,
        branches: [branch],
      }).branches,
    ).toEqual([branch]);
  },
);
it.each([0, 5, 2.5])('refuses invalid limit %s', (max_shifts_per_day) => {
  expect(setScheduleSettingsInput.safeParse({ max_shifts_per_day }).success).toBe(false);
});
