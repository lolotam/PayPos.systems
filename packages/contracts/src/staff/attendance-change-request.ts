import { z } from 'zod';
import { id } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';

const reason = z.string().trim().min(1).max(500);
const revision = z.number().int().min(0).max(2147483647);
export const attendanceChangeKind = z.enum(['ADD_SESSION', 'VOID_SESSION']);
export const attendanceChangeStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const envelope = {
  employee_id: id,
  reason,
  session_id: id.optional(),
  session_revision: revision.optional(),
};
export const attendanceChangeRequestInput = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('ADD_SESSION'),
      employee_id: id,
      branch_id: id,
      clock_in: timestamp,
      clock_out: timestamp,
      reason,
    }),
    z.strictObject({ ...envelope, kind: z.literal('VOID_SESSION') }),
  ])
  .meta({ id: 'AttendanceChangeRequestInput' });
export const cancelAttendanceChangeInput = z
  .strictObject({ revision })
  .meta({ id: 'CancelAttendanceChangeInput' });
export const decideAttendanceChangeInput = z
  .discriminatedUnion('decision', [
    z.strictObject({ decision: z.literal('APPROVED'), revision, reason: reason.optional() }),
    z.strictObject({ decision: z.literal('REJECTED'), revision, reason }),
  ])
  .meta({ id: 'DecideAttendanceChangeInput' });
export const attendanceChangeCursor = z.strictObject({ requested_at: timestamp, id });
export const attendanceChangeListQuery = z
  .strictObject({
    status: attendanceChangeStatus.optional(),
    branch_id: id.optional(),
    employee_id: id.optional(),
    kind: attendanceChangeKind.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'AttendanceChangeListQuery' });
export const attendanceChangeRequest = z
  .strictObject({
    id,
    kind: attendanceChangeKind,
    status: attendanceChangeStatus,
    business_id: id,
    branch_id: id,
    employee: z.strictObject({ id, name_ar: z.string().nullable(), name_en: z.string() }),
    session_id: id.nullable(),
    session_revision: revision.nullable(),
    requested: z
      .strictObject({
        clock_in: timestamp,
        clock_out: timestamp,
        working_date: z.iso.date(),
        timezone: z.string(),
      })
      .nullable(),
    reason: z.string(),
    requested_by: id,
    requested_at: timestamp,
    decided_by: id.nullable(),
    decided_at: timestamp.nullable(),
    decision_reason: z.string().nullable(),
    cancelled_by: id.nullable(),
    cancelled_at: timestamp.nullable(),
    revision,
    can_decide: z.boolean(),
    can_cancel: z.boolean(),
  })
  .meta({ id: 'AttendanceChangeRequest' });
export const attendanceChangeDecisionResult = attendanceChangeRequest
  .extend({ effect: z.null() })
  .meta({ id: 'AttendanceChangeDecisionResult' });
export const attendanceChangeRequestPage = z
  .strictObject({
    items: z.array(attendanceChangeRequest),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'AttendanceChangeRequestPage' });
export type AttendanceChangeRequestInput = z.infer<typeof attendanceChangeRequestInput>;
export type CancelAttendanceChangeInput = z.infer<typeof cancelAttendanceChangeInput>;
export type DecideAttendanceChangeInput = z.infer<typeof decideAttendanceChangeInput>;
export type AttendanceChangeListQuery = z.infer<typeof attendanceChangeListQuery>;
export type AttendanceChangeRequest = z.infer<typeof attendanceChangeRequest>;
export type AttendanceChangeDecisionResult = z.infer<typeof attendanceChangeDecisionResult>;
export type AttendanceChangeRequestPage = z.infer<typeof attendanceChangeRequestPage>;
export const attendanceChangeSchemas = [
  attendanceChangeRequestInput,
  cancelAttendanceChangeInput,
  decideAttendanceChangeInput,
  attendanceChangeListQuery,
  attendanceChangeRequest,
  attendanceChangeDecisionResult,
  attendanceChangeRequestPage,
];
