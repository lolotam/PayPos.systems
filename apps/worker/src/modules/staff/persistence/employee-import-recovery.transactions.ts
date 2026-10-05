import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ImportRecoveryTransactions } from '../ports/employee-import-recovery.port.ts';

export function importRecoveryCandidates(companyId: string, before: Date) {
  return sql`SELECT id FROM import_previews WHERE company_id=${companyId} AND status='commit_requested'
    AND requested_at<=${before.toISOString()} AND entity='employees' ORDER BY requested_at,id LIMIT 50`;
}

export function employeeImportRecoveryTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): ImportRecoveryTransactions {
  return {
    candidates: (companyId, before) =>
      database.withTenant(companyId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(importRecoveryCandidates(companyId, before));
        return rows.map((row) => row.id);
      }),
    failStale: (companyId, previewId, before) =>
      database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE import_previews SET status='failed',error_code='IMPORT_COMMIT_FAILED'
        WHERE company_id=${companyId} AND id=${previewId} AND status='commit_requested'
        AND requested_at<=${before.toISOString()} AND entity='employees'`);
      }),
  };
}
