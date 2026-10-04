import { z } from 'zod';
import { employeeDate, employeeInputId } from './employee.js';
import { cancelLeaveInput, leaveListQuery } from './leave.js';

const reason = z.string().trim().min(1).max(500);
export const decideLeaveInput = z
  .discriminatedUnion('decision', [
    cancelLeaveInput.extend({ decision: z.literal('APPROVED'), reason: reason.optional() }),
    cancelLeaveInput.extend({ decision: z.literal('REJECTED'), reason }),
  ])
  .meta({ id: 'DecideLeaveInput' });
export const revokeLeaveInput = cancelLeaveInput
  .extend({ reason })
  .meta({ id: 'RevokeLeaveInput' });
export const leaveInboxQuery = leaveListQuery
  .extend({
    branch_id: employeeInputId.optional(),
    from: employeeDate.optional(),
    to: employeeDate.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    path: ['to'],
    message: 'Invalid date range',
  })
  .meta({ id: 'LeaveInboxQuery' });
export type DecideLeaveInput = z.infer<typeof decideLeaveInput>;
export type RevokeLeaveInput = z.infer<typeof revokeLeaveInput>;
export type LeaveInboxQuery = z.infer<typeof leaveInboxQuery>;
export const leaveDecisionSchemas = [decideLeaveInput, revokeLeaveInput, leaveInboxQuery];
