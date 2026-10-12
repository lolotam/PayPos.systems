import { z } from 'zod';

export const attendanceCapabilities = z
  .strictObject({
    correct: z.boolean(),
    resolve: z.boolean(),
    request_change: z.boolean(),
    decide: z.boolean(),
  })
  .meta({ id: 'AttendanceCapabilities' });
export type AttendanceCapabilities = z.infer<typeof attendanceCapabilities>;
