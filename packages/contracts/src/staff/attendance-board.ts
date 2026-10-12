import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { employeeDate } from './employee.js';
import { attendanceActorName } from './attendance-actor-name.js';

export const attendanceBoardQuery = z
  .strictObject({
    date: employeeDate.optional(),
  })
  .meta({ id: 'AttendanceBoardQuery' });
const refusalCursor = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split('|');
    return (
      parts.length === 2 && timestamp.safeParse(parts[0]).success && id.safeParse(parts[1]).success
    );
  });
export const attendanceBoardRefusalsQuery = z
  .strictObject({
    cursor: refusalCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'AttendanceBoardRefusalsQuery' });
const employeeFields = { employee_id: id, name_ar: z.string().nullable(), name_en: z.string() };
const source = z.enum(['QR', 'BARCODE', 'MANUAL']);
const geo = z.enum(['OK', 'NONE', 'OUT_OF_RANGE']);
export const attendanceBoard = z
  .strictObject({
    branch_id: id,
    date: employeeDate,
    timezone: z.string(),
    generated_at: timestamp,
    owner: z.boolean(),
    in_now: z.array(
      z.strictObject({
        ...employeeFields,
        clock_in: timestamp,
        source,
        scheduled_end: timestamp.nullable(),
      }),
    ),
    sessions: z.array(
      z.strictObject({
        id,
        ...employeeFields,
        own: z.boolean(),
        clock_in: timestamp,
        clock_out: timestamp.nullable(),
        status: z.enum(['OPEN', 'CLOSED', 'MISSED_OUT']),
        source,
        late_minutes: z.number().int().nonnegative(),
        scheduled_start: timestamp.nullable(),
        scheduled_end: timestamp.nullable(),
        geo,
        out_geo: geo.nullable(),
        corrected: z.boolean(),
        revision: z.number().int().nonnegative(),
        open_exceptions: z.array(
          z.strictObject({ id, kind: z.enum(['NONE', 'OUT_OF_RANGE', 'SUSPECTED_MISSED_OUT']) }),
        ),
        manual: z
          .strictObject({
            change_request_id: id,
            requested_by: id,
            requested_by_name: attendanceActorName,
            approved_by: id,
            approved_by_name: attendanceActorName,
          })
          .nullable(),
      }),
    ),
  })
  .meta({ id: 'AttendanceBoard' });
export type AttendanceBoard = z.infer<typeof attendanceBoard>;
export type AttendanceBoardQuery = z.infer<typeof attendanceBoardQuery>;
export type AttendanceBoardRefusalsQuery = z.infer<typeof attendanceBoardRefusalsQuery>;
