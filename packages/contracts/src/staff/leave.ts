import { z } from 'zod';
import { id } from '../scalars/id.js';
import { employeeDate, employeeInputId } from './employee.js';
import { timeZone } from '../reference/time-zone.js';

export const leaveType = z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']);
export const leaveStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const partialTime = time.regex(/:(?:00|15|30|45)$/, { message: 'LEAVE_TIME_STEP_INVALID' });
const common = { type: leaveType, note: z.string().trim().min(1).max(500).optional() };
const full = z.strictObject({
  ...common,
  kind: z.literal('FULL_DAY'),
  from: employeeDate,
  to: employeeDate.describe('Inclusive end date; full-day requests span at most 90 civil days.'),
});
const partial = z.strictObject({
  ...common,
  kind: z.literal('PARTIAL'),
  date: employeeDate,
  start: partialTime,
  end: partialTime,
});
const noteRequired = (input: { type: string; note?: string | undefined }) =>
  input.type !== 'OTHER' || !!input.note;
const withinSpan = (input: z.infer<typeof full> | z.infer<typeof partial>) => {
  if (input.kind !== 'FULL_DAY') return true;
  const days =
    (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 + 1;
  return !Number.isFinite(days) || days <= 90;
};
export const requestLeaveInput = z
  .discriminatedUnion('kind', [full, partial])
  .refine(noteRequired, { path: ['note'], message: 'OTHER requires note' })
  .refine(withinSpan, { path: ['to'], message: 'LEAVE_SPAN_TOO_LONG' })
  .meta({ id: 'RequestLeaveInput' });
export const requestEmployeeLeaveInput = z
  .discriminatedUnion('kind', [
    full.extend({ branch_id: employeeInputId }),
    partial.extend({ branch_id: employeeInputId }),
  ])
  .refine(noteRequired, { path: ['note'], message: 'OTHER requires note' })
  .refine(withinSpan, { path: ['to'], message: 'LEAVE_SPAN_TOO_LONG' })
  .meta({ id: 'RequestEmployeeLeaveInput' });
export const cancelLeaveInput = z
  .strictObject({ expected_revision: z.number().int().positive().max(2147483646) })
  .meta({ id: 'CancelLeaveInput' });
export const leaveRequest = z
  .object({
    id,
    business_id: id,
    branch_id: id,
    employee_id: id,
    kind: z.enum(['FULL_DAY', 'PARTIAL']),
    from: employeeDate,
    to: employeeDate,
    start: time.nullable(),
    end: time.nullable(),
    timezone: timeZone,
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    type: leaveType,
    note: z.string().nullable(),
    status: leaveStatus,
    requested_by: id,
    requested_at: z.iso.datetime(),
    cancelled_by: id.nullable(),
    cancelled_at: z.iso.datetime().nullable(),
    decided_by: id.nullable(),
    decided_at: z.iso.datetime().nullable(),
    rejection_reason: z.string().nullable(),
    decision_reason: z.string().nullable(),
    revoked_by: id.nullable(),
    revoked_at: z.iso.datetime().nullable(),
    revocation_reason: z.string().nullable(),
    revision: z.number().int().positive(),
  })
  .meta({ id: 'LeaveRequest' });
export const leaveListQuery = z
  .strictObject({
    cursor: employeeInputId.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: 'LeaveListQuery' });
export const ownLeaveBranchQuery = z.strictObject({ branch_id: employeeInputId.optional() });
export const ownLeaveListQuery = leaveListQuery.extend({ branch_id: employeeInputId.optional() });
export const leaveListItem = leaveRequest
  .extend({
    employee_name_en: z.string(),
    employee_name_ar: z.string().nullable(),
    can_cancel: z.boolean(),
    can_decide: z.boolean(),
    can_revoke: z.boolean(),
  })
  .meta({ id: 'LeaveListItem' });
export const leavePage = z
  .object({
    items: z.array(leaveListItem),
    next_cursor: id.nullable(),
    request_branch_ids: z.array(id),
  })
  .meta({ id: 'LeavePage' });
export type RequestLeaveInput = z.infer<typeof requestLeaveInput>;
export type RequestEmployeeLeaveInput = z.infer<typeof requestEmployeeLeaveInput>;
export type CancelLeaveInput = z.infer<typeof cancelLeaveInput>;
export type LeaveRequest = z.infer<typeof leaveRequest>;
export type LeaveListQuery = z.infer<typeof leaveListQuery>;
export type OwnLeaveBranchQuery = z.infer<typeof ownLeaveBranchQuery>;
export type OwnLeaveListQuery = z.infer<typeof ownLeaveListQuery>;
export type LeavePage = z.infer<typeof leavePage>;
export const leaveSchemas = [
  requestLeaveInput,
  requestEmployeeLeaveInput,
  cancelLeaveInput,
  leaveRequest,
  leaveListQuery,
  leaveListItem,
  leavePage,
];
