import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';
import { employeeInputId } from './employee.js';
import {
  historyDate,
  historyStatus,
  historyType,
  leaveHistoryPage,
  leaveHistoryRange,
} from './leave-history.js';
import {
  LEAVE_HISTORY_REPORT_FAILURE_CODES,
  LEAVE_HISTORY_REPORT_ROW_CAP,
} from './leave-history-report-job.js';

export const leaveHistoryReportRequest = z
  .strictObject({
    from: historyDate,
    to: historyDate,
    'types[]': z.array(historyType).max(5).default([]),
    'statuses[]': z.array(historyStatus).max(5).default([]),
    branch_id: employeeInputId.optional(),
  })
  .refine(leaveHistoryRange, { path: ['to'], message: 'LEAVE_HISTORY_RANGE_INVALID' })
  .meta({ id: 'LeaveHistoryReportRequest' });

export const leaveHistoryReportAccepted = responseObject({ report_id: id }).meta({
  id: 'LeaveHistoryReportAccepted',
});

export const leaveHistoryReportResultQuery = z.strictObject({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const leaveHistoryReportCursorData = z.strictObject({
  report_id: id,
  seq: z.number().int().min(0).max(LEAVE_HISTORY_REPORT_ROW_CAP),
});

const leaveHistoryReportFailure = responseObject({
  code: z.enum(LEAVE_HISTORY_REPORT_FAILURE_CODES),
  message_ar: z.string().min(1),
  message_en: z.string().min(1),
});

export const leaveHistoryReportStatus = z
  .discriminatedUnion('status', [
    responseObject({ status: z.literal('pending') }),
    responseObject({ status: z.literal('failed'), error: leaveHistoryReportFailure }),
    leaveHistoryPage.extend({ status: z.literal('ready'), computed_at: z.iso.datetime() }),
  ])
  .meta({ id: 'LeaveHistoryReportStatus' });

export type LeaveHistoryReportRequest = z.infer<typeof leaveHistoryReportRequest>;
export type LeaveHistoryReportAccepted = z.infer<typeof leaveHistoryReportAccepted>;
export type LeaveHistoryReportResultQuery = z.infer<typeof leaveHistoryReportResultQuery>;
export type LeaveHistoryReportCursorData = z.infer<typeof leaveHistoryReportCursorData>;
export type LeaveHistoryReportStatus = z.infer<typeof leaveHistoryReportStatus>;

export const leaveHistoryReportApiSchemas = [
  leaveHistoryReportRequest,
  leaveHistoryReportAccepted,
  leaveHistoryReportStatus,
];
