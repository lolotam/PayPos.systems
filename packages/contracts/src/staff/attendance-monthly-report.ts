import { z } from 'zod';
import { id } from '../scalars/id.js';

export const attendanceReportMonth = z.string().regex(/^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/);
export const attendanceMonthlyReportQuery = z.object({
  month: attendanceReportMonth,
}).strict().meta({ id: 'AttendanceMonthlyReportQuery' });

const count = z.number().int().nonnegative();
export const attendanceReportLeave = z.object({
  type: z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']),
  days: count,
  partial_minutes: count,
}).strict();
export const attendanceMonthlyReportRow = z.object({
  employee_id: id,
  name_ar: z.string().nullable(),
  name_en: z.string(),
  days_present: count,
  worked_minutes: count,
  scheduled_minutes: count,
  contracted_minutes: count,
  leave: z.array(attendanceReportLeave),
  difference_minutes: z.number().int(),
  late_count: count,
  late_minutes: count,
  missing_clock_out: count,
  manual_days: count,
}).strict().meta({ id: 'AttendanceMonthlyReportRow' });
export const attendanceMonthlyReport = z.object({
  business_id: id,
  branch_id: z.union([id, z.literal('all')]),
  month: attendanceReportMonth,
  rows: z.array(attendanceMonthlyReportRow),
}).strict().meta({ id: 'AttendanceMonthlyReport' });
export type AttendanceMonthlyReportQuery = z.infer<typeof attendanceMonthlyReportQuery>;
export type AttendanceMonthlyReportRow = z.infer<typeof attendanceMonthlyReportRow>;
export type AttendanceMonthlyReport = z.infer<typeof attendanceMonthlyReport>;
