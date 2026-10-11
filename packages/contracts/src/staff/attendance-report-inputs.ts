import { z } from 'zod';
import { scheduleShift } from './schedules.js';

// إسقاط داخلي لقراءة التقرير؛ SQL يجمع المدخلات لكل موظفة بدل تمرير آلاف صفوف عبر mapper.
export const attendanceReportBranchInputs = z.object({
  timezone: z.string(),
  sessions: z.array(z.object({
    working_date: z.string(), clock_in: z.string(), clock_out: z.string().nullable(),
    status: z.enum(['OPEN', 'CLOSED', 'MISSED_OUT']), source: z.enum(['QR', 'BARCODE', 'MANUAL']),
    late_minutes: z.number().int(), scheduled_end: z.string().nullable(),
    clock_out_corrected: z.boolean(), voided: z.boolean(),
  })),
  shifts: z.array(z.object({ working_date: z.string(), starts_at: z.string(), ends_at: z.string(),
    break_starts_at: z.string().nullable(), break_ends_at: z.string().nullable() })),
  contract: z.object({ hire_date: z.string(), contract_end: z.string().nullable(),
    links: z.array(z.object({ from: z.string(), to: z.string().nullable() })), entries: z.array(scheduleShift) }).nullable(),
  leave_for_branch: z.array(z.object({ type: z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']),
    kind: z.enum(['FULL_DAY', 'PARTIAL']), from: z.string(), to: z.string(),
    starts_at: z.string(), ends_at: z.string() })),
});
export type AttendanceReportBranchInputs = z.infer<typeof attendanceReportBranchInputs>;
