import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

export const ownAttendanceQuery = z.strictObject({
  month: z
    .string()
    .regex(/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/)
    .optional(),
});
export const ownAttendanceSession = z.strictObject({
  id,
  working_date: z.iso.date(),
  branch_name_ar: z.string().nullable(),
  branch_name_en: z.string(),
  clock_in: timestamp,
  clock_out: timestamp.nullable(),
  late_minutes: z.number().int().nonnegative(),
  source: z.enum(['QR', 'BARCODE', 'MANUAL']),
  status: z.enum(['OPEN', 'CLOSED', 'MISSED_OUT']),
  open_exceptions: z.array(z.enum(['NONE', 'OUT_OF_RANGE', 'SUSPECTED_MISSED_OUT'])),
  corrected: z.boolean(),
});
export const ownAttendance = z.strictObject({
  month: z.string(),
  sessions: z.array(ownAttendanceSession),
});
export type OwnAttendance = z.infer<typeof ownAttendance>;
