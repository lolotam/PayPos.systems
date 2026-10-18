import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { attendanceActorName } from './attendance-actor-name.js';
import { attendanceExceptionRecord } from './attendance-exception.js';

const cursor = z
  .string()
  .max(100)
  .refine((value) => {
    const parts = value.split('|');
    return (
      parts.length === 2 && timestamp.safeParse(parts[0]).success && id.safeParse(parts[1]).success
    );
  });
export const attendanceExceptionsListQuery = z
  .strictObject({
    status: z.enum(['OPEN', 'RESOLVED']).default('OPEN'),
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'AttendanceExceptionsListQuery' });
export const attendanceExceptionListItem = attendanceExceptionRecord
  .omit({ session_id: true, employee_id: true })
  .extend({
    own: z.boolean(),
    can_resolve: z.boolean(),
    session: responseObject({
      id,
      working_date: z.iso.date(),
      clock_in: timestamp,
      clock_out: timestamp.nullable(),
      status: z.enum(['OPEN', 'CLOSED', 'MISSED_OUT']),
    }),
    employee: responseObject({ id, name_ar: z.string().nullable(), name_en: z.string() }),
  })
  .meta({ id: 'AttendanceExceptionListItem' });
export const attendanceExceptionPage = responseObject({ items: z.array(attendanceExceptionListItem), next_cursor: cursor.nullable() })
  .meta({ id: 'AttendanceExceptionPage' });
export const attendanceCorrectionHistory = responseObject({
    items: z.array(
      responseObject({
        id,
        field: z.enum(['CLOCK_IN', 'CLOCK_OUT']),
        before_at: timestamp,
        after_at: timestamp,
        reason: z.string(),
        corrected_by: responseObject({ id, name: attendanceActorName }),
        corrected_at: timestamp,
      }),
    ),
  })
  .meta({ id: 'AttendanceCorrectionHistory' });
export type AttendanceExceptionsListQuery = z.infer<typeof attendanceExceptionsListQuery>;
export type AttendanceExceptionPage = z.infer<typeof attendanceExceptionPage>;
export type AttendanceCorrectionHistory = z.infer<typeof attendanceCorrectionHistory>;
