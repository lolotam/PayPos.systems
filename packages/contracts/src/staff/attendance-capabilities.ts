import { z } from 'zod';
import { responseObject } from '../response-object.js';

export const attendanceCapabilities = responseObject({
    correct: z.boolean(),
    resolve: z.boolean(),
    request_change: z.boolean(),
    decide: z.boolean(),
  })
  .meta({ id: 'AttendanceCapabilities' });
export type AttendanceCapabilities = z.infer<typeof attendanceCapabilities>;
