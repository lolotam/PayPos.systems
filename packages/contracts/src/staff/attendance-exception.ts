import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const reason = z.string().trim().min(1).max(500);
export const attendanceExceptionDecisionInput = z
  .strictObject({
    revision: z.number().int().min(0),
    reason,
  })
  .meta({ id: 'AttendanceExceptionDecisionInput' });
export const attendanceExceptionRecord = z
  .strictObject({
    id,
    session_id: id,
    employee_id: id,
    branch_id: id,
    kind: z.enum(['NONE', 'OUT_OF_RANGE', 'SUSPECTED_MISSED_OUT']),
    status: z.enum(['OPEN', 'RESOLVED']),
    resolution: z.enum(['CLOSED_LATE', 'MISSED_OUT', 'ACKNOWLEDGED', 'CARD_SCAN']).nullable(),
    resolved_by: id.nullable(),
    resolved_at: timestamp.nullable(),
    reason: z.string().nullable(),
    raised_at: timestamp,
    revision: z.number().int().min(0),
  })
  .meta({ id: 'AttendanceExceptionRecord' });
export type AttendanceExceptionDecisionInput = z.infer<typeof attendanceExceptionDecisionInput>;
export type AttendanceExceptionRecord = z.infer<typeof attendanceExceptionRecord>;
export const attendanceExceptionSchemas = [
  attendanceExceptionDecisionInput,
  attendanceExceptionRecord,
];
