import { z } from 'zod';
import { id } from '../scalars/id.js';

export const setScheduleSettingsInput = z
  .strictObject({
    max_shifts_per_day: z.number().int().min(1).max(4),
  })
  .meta({ id: 'SetScheduleSettingsInput' });
export const scheduleSettingsSource = z.enum(['branch', 'business', 'default']);
export const branchScheduleSettings = z.object({
  branch_id: id,
  max_shifts_per_day: z.number().int().min(1).max(4),
  source: scheduleSettingsSource,
  updated_at: z.iso.datetime().nullable(),
});
export const scheduleSettings = z
  .object({
    business_id: id,
    max_shifts_per_day: z.number().int().min(1).max(4),
    is_default: z.boolean(),
    updated_at: z.iso.datetime().nullable(),
    branches: z.array(branchScheduleSettings).optional(),
  })
  .meta({ id: 'ScheduleSettings' });
export type SetScheduleSettingsInput = z.infer<typeof setScheduleSettingsInput>;
export type ScheduleSettings = z.infer<typeof scheduleSettings>;
export type BranchScheduleSettings = z.infer<typeof branchScheduleSettings>;
