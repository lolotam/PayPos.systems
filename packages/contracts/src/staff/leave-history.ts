import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { employeeDate, employeeInputId } from './employee.js';
import { leaveListItem } from './leave.js';

// PostgreSQL لا يقبل سنة صفر، فلازم نرفضها قبل تحويل المدخلات داخل SQL.
// نمط واحد مشتق من نمط التاريخ نفسه عشان OpenAPI يفضل format: date ويوصف الرفض بدقة.
export const historyDate = z.stringFormat(
  'date',
  new RegExp(`^(?!0000-)${z.regexes.date.source.slice(1)}`),
);
export const leaveHistoryCursorData = z.strictObject({
  date: historyDate,
  rank: z.number().int().min(1).max(3),
  id: z.uuid(),
  as_of: z.iso.datetime().regex(/^(?!0000-)/),
});
export type LeaveHistoryCursorData = z.infer<typeof leaveHistoryCursorData>;

export const historyType = z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER', 'UNEXCUSED_ABSENCE']);
export const historyStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ABSENT']);
const leaveHistoryQueryShape = {
  from: historyDate,
  to: historyDate,
  'types[]': z
    .union([z.array(historyType), historyType])
    .transform((v) => (typeof v === 'string' ? [v] : v))
    .default([]),
  'statuses[]': z
    .union([z.array(historyStatus), historyStatus])
    .transform((v) => (typeof v === 'string' ? [v] : v))
    .default([]),
  branch_id: employeeInputId.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};
export const leaveHistoryRange = (q: { from: string; to: string }) =>
  q.from <= q.to &&
  Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`) < 366 * 86_400_000;
export const leaveHistoryQuery = z
  .strictObject(leaveHistoryQueryShape)
  .refine(leaveHistoryRange, { path: ['to'], message: 'LEAVE_HISTORY_RANGE_INVALID' })
  .meta({ id: 'LeaveHistoryQuery' });
export const leaveHistoryReportQuery = z
  .strictObject({ ...leaveHistoryQueryShape, employee_id: employeeInputId.optional() })
  .refine(leaveHistoryRange, { path: ['to'], message: 'LEAVE_HISTORY_RANGE_INVALID' });
const employee = {
  employee_id: id,
  employee_name_en: z.string(),
  employee_name_ar: z.string().nullable(),
  employee_number: z.number().int().min(1).max(999999),
};
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const shift = responseObject({ start: time, end: time });
export const leaveHistoryItem = z
  .discriminatedUnion('row_type', [
    leaveListItem.extend({ ...employee, row_type: z.literal('LEAVE') }),
    responseObject({
      ...employee,
      row_type: z.literal('UNEXCUSED_ABSENCE'),
      id,
      working_date: employeeDate,
      branch_id: id,
      shifts: z.array(shift),
      status: z.literal('ABSENT'),
    }),
    responseObject({
      ...employee,
      row_type: z.literal('COVERED_ELSEWHERE'),
      id,
      working_date: employeeDate,
      branch_id: id,
      shift,
    }),
  ])
  .meta({ id: 'LeaveHistoryItem' });
const range = responseObject({ from: employeeDate, to: employeeDate }).nullable();
export const leaveHistoryPage = responseObject({
  items: z.array(leaveHistoryItem),
  next_cursor: z.string().nullable(),
  as_of: z.iso.datetime(),
  last_taken: responseObject({
    annual: range,
    sick: range,
    unpaid: range,
    unexcused_absence: employeeDate.nullable().optional(),
  }).nullable(),
  request_branch_ids: z.array(id),
  absence_branch_ids: z.array(id),
}).meta({ id: 'LeaveHistoryPage' });
export type LeaveHistoryQuery = z.infer<typeof leaveHistoryQuery>;
export type LeaveHistoryReportQuery = z.infer<typeof leaveHistoryReportQuery>;
export type LeaveHistoryItem = z.infer<typeof leaveHistoryItem>;
export type LeaveHistoryPage = z.infer<typeof leaveHistoryPage>;
// القاعدة دي بتقول هل days هيشتغل بس؛ عدد الإجازات المطابقة مابيبانش منها، فقرار الرفض (422) للسيرفر لوحده.
export function leaveHistoryReportSkipsDays(
  q: Pick<LeaveHistoryReportQuery, 'types[]' | 'statuses[]'>,
): boolean {
  return (
    (q['types[]'].length > 0 && !q['types[]'].includes('UNEXCUSED_ABSENCE')) ||
    (q['statuses[]'].length > 0 && !q['statuses[]'].includes('ABSENT'))
  );
}
export const leaveHistorySchemas = [leaveHistoryQuery, leaveHistoryItem, leaveHistoryPage];
