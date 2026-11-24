import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { CoverageReportIdentity } from '../ports/coverage-issuance.port.ts';

/** نفس اتصال التقرير، داخل withTenant وبلا ensure أو أية كتابة. */
export function coverageReportIdentity(database: Pick<TenantWrappers, 'withTenant'>) {
  return (companyId: string): Promise<CoverageReportIdentity> =>
    database.withTenant(companyId, async (tx) => {
      const [row] = await tx.execute<{
        database_name: string;
        system_id: string;
        in_recovery: boolean;
        version: number;
        tip_bound: string;
      }>(sql`
      SELECT current_database()::text AS database_name, public.pospay_system_id()::text AS system_id,
        pg_is_in_recovery() AS in_recovery,
        public.commission_coverage_required_version() AS version,
        ((clock_timestamp() AT TIME ZONE 'UTC')::date + 1)::text AS tip_bound`);
      if (row === undefined) throw new Error('COVERAGE_DATABASE_MISMATCH');
      return {
        databaseName: row.database_name,
        systemId: row.system_id,
        inRecovery: row.in_recovery === true,
        version: row.version,
        tipBound: row.tip_bound,
      };
    });
}
