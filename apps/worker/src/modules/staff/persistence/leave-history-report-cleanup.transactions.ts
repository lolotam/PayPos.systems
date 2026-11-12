import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LeaveHistoryReportCleanupTransactions } from '../ports/leave-history-report.port.ts';

const CLEANUP_BATCH_SIZE = 2;

export function leaveHistoryReportCleanupTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  timeoutMs: number,
): LeaveHistoryReportCleanupTransactions {
  return {
    deleteExpired: (companyId) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const deleted = await tx.execute<{ id: string }>(sql`WITH candidates AS (
            SELECT id FROM leave_history_reports
            WHERE company_id=${companyId} AND expires_at<=now()
            ORDER BY expires_at,id LIMIT ${CLEANUP_BATCH_SIZE} FOR UPDATE SKIP LOCKED
          ) DELETE FROM leave_history_reports target
          USING candidates WHERE target.company_id=${companyId} AND target.id=candidates.id
          RETURNING target.id`);
          return deleted.length;
        },
        { timeoutMs },
      ),
  };
}
