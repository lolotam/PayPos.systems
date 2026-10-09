import { z } from 'zod';
import { id } from '../scalars/id.js';

export const setScheduleSettingsInput = z
  .strictObject({
    max_shifts_per_day: z.number().int().min(1).max(4),
  })
  .meta({ id: 'SetScheduleSettingsInput' });
export const scheduleSettings = z
  .object({
    business_id: id,
    max_shifts_per_day: z.number().int().min(1).max(4),
    is_default: z.boolean(),
    updated_at: z.iso.datetime().nullable(),
  })
  .meta({ id: 'ScheduleSettings' });
export type SetScheduleSettingsInput = z.infer<typeof setScheduleSettingsInput>;
export type ScheduleSettings = z.infer<typeof scheduleSettings>;
