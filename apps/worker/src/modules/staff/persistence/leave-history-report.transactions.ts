import type { TenantWrappers } from '@pospay/db';
import { LEAVE_HISTORY_REPORT_ROW_CAP } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  LeaveHistoryReportStatus,
  LeaveHistoryReportTransactions,
} from '../ports/leave-history-report.port.ts';
import { buildLeaveHistoryReport } from './leave-history-report-build.ts';

export function leaveHistoryReportTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  timeoutMs: number,
  rowCap = LEAVE_HISTORY_REPORT_ROW_CAP,
  failureTimeoutMs = timeoutMs,
): LeaveHistoryReportTransactions {
  return {
    build: (companyId, reportId) =>
      database.withTenant(
        companyId,
        (tx) => buildLeaveHistoryReport(tx, companyId, reportId, rowCap),
        { timeoutMs },
      ),
    fail: (companyId, reportId, code) =>
      database.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(sql`UPDATE leave_history_reports
            SET status='failed',error_code=${code}
            WHERE company_id=${companyId} AND id=${reportId} AND status='pending'`);
        },
        { timeoutMs: failureTimeoutMs },
      ),
    readStatus: (companyId, reportId) =>
      database.withTenant(companyId, async (tx) => {
        const [row] = await tx.execute<{ status: LeaveHistoryReportStatus }>(sql`
          SELECT status FROM leave_history_reports
          WHERE company_id=${companyId} AND id=${reportId}`);
        return row?.status ?? null;
      }),
    readCreator: (companyId, reportId) =>
      database.withTenant(companyId, async (tx) => {
        const [row] = await tx.execute<{ created_by: string }>(sql`
          SELECT created_by FROM leave_history_reports
          WHERE company_id=${companyId} AND id=${reportId}`);
        return row?.created_by ?? null;
      }),
  };
}
