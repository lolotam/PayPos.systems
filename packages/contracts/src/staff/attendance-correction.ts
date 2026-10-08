import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const reason = z.string().trim().min(1).max(500);
export const correctAttendanceInput = z
  .strictObject({
    revision: z.number().int().min(0),
    clock_in: timestamp.optional(),
    clock_out: timestamp.optional(),
    reason,
  })
  .refine((input) => input.clock_in !== undefined || input.clock_out !== undefined, {
    message: 'At least one time is required',
  })
  .meta({ id: 'CorrectAttendanceInput' });
const correctedSession = z.strictObject({
  id,
  employee_id: id,
  branch_id: id,
  working_date: z.iso.date(),
  clock_in: timestamp,
  clock_out: timestamp,
  status: z.enum(['CLOSED', 'MISSED_OUT']),
  closed_by: z.enum(['EMPLOYEE', 'MISSED_OUT']),
  late_minutes: z.number().int().min(0),
  revision: z.number().int().min(0),
});
const correctionRow = z.strictObject({
  id,
  field: z.enum(['CLOCK_IN', 'CLOCK_OUT']),
  before: timestamp,
  after: timestamp,
  reason: z.string(),
  corrected_by: id,
  corrected_at: timestamp,
});
export const correctAttendanceResult = z
  .strictObject({
    session: correctedSession,
    corrections: z.array(correctionRow),
  })
  .meta({ id: 'CorrectAttendanceResult' });
export type CorrectAttendanceInput = z.infer<typeof correctAttendanceInput>;
export type CorrectAttendanceResult = z.infer<typeof correctAttendanceResult>;
export const attendanceCorrectionSchemas = [correctAttendanceInput, correctAttendanceResult];
