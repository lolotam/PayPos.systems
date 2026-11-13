import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PackageSaleRecoveryTransactions } from '../ports/package-sale-recovery.port.ts';

export function packageSaleRecoveryTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
): PackageSaleRecoveryTransactions {
  return {
    candidates: (companyId, before) =>
      database.withTenant(companyId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          SELECT id FROM package_sale_requests
          WHERE company_id=${companyId} AND status='pending' AND recorded_at<=${before.toISOString()}
          ORDER BY recorded_at,id LIMIT 50`);
        return rows.map((row) => row.id);
      }),
    failStale: (companyId, requestId, before, at) =>
      database.withTenant(companyId, async (tx) => {
        await tx.execute(sql`UPDATE package_sale_requests
          SET status='failed',error_code='PACKAGE_SALE_FAILED',finished_at=${at}
          WHERE company_id=${companyId} AND id=${requestId} AND status='pending'
          AND recorded_at<=${before.toISOString()}`);
      }),
  };
}
