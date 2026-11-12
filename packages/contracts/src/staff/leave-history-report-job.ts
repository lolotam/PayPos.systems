import { z } from 'zod';
import { id } from '../scalars/id.js';

const historyDate = z.stringFormat(
  'date',
  new RegExp(`^(?!0000-)${z.regexes.date.source.slice(1)}`),
);
const historyType = z.enum(['ANNUAL', 'SICK', 'UNPAID', 'OTHER', 'UNEXCUSED_ABSENCE']);
const historyStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ABSENT']);

export const LEAVE_HISTORY_REPORT_ROW_CAP = 25_000;
export const LEAVE_HISTORY_REPORT_RETENTION_MS = 3_600_000;
export const LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS = 3_600_000;
export const LEAVE_HISTORY_REPORT_FAILURE_CODES = [
  'LEAVE_HISTORY_REPORT_FAILED',
  'LEAVE_HISTORY_REPORT_TOO_LARGE',
] as const;
export type LeaveHistoryReportFailureCode = (typeof LEAVE_HISTORY_REPORT_FAILURE_CODES)[number];

export const leaveHistoryReportRequested = z.strictObject({ report_id: id });
export type LeaveHistoryReportRequested = z.infer<typeof leaveHistoryReportRequested>;

export const leaveHistoryReportJob = z.strictObject({ companyId: id, reportId: id });
export type LeaveHistoryReportJob = z.infer<typeof leaveHistoryReportJob>;

export const leaveHistoryReportStoredQuery = z
  .strictObject({
    from: historyDate,
    to: historyDate,
    'types[]': z.array(historyType),
    'statuses[]': z.array(historyStatus),
    branch_id: id.optional(),
  })
  .refine(
    (query) =>
      query.from <= query.to &&
      Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`) <
        366 * 86_400_000,
    { path: ['to'], message: 'LEAVE_HISTORY_RANGE_INVALID' },
  );
export type LeaveHistoryReportStoredQuery = z.infer<typeof leaveHistoryReportStoredQuery>;

export const leaveHistoryReportStoredScope = z.strictObject({
  branches: z.array(id),
  attendanceBranches: z.array(id),
  cancelBranches: z.array(id),
  decideBranches: z.array(id),
  revokeBranches: z.array(id),
  createBranches: z.array(id),
  eligibilityBranchIds: z.array(id),
});
export type LeaveHistoryReportStoredScope = z.infer<typeof leaveHistoryReportStoredScope>;
