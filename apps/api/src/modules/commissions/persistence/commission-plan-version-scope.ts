import { lockStatementPeriods, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import type { BusinessTimeZonePort } from '../ports/business-time-zone.port.ts';
import type { CommissionPlanAccessPort } from '../ports/commission-plan-access.port.ts';
import type {
  CommissionPlanVersionActor,
  CommissionPlanVersionScope,
} from '../ports/commission-plan-version-transactions.port.ts';
import type { EmployeeRowLockPort } from '../ports/employee-row-lock.port.ts';
import { auditPlanVersion, insertPlanVersion } from './commission-plan-version-writer.ts';

export interface CommissionPlanVersionReaders {
  readonly businessTimeZone: BusinessTimeZonePort['read'];
  readonly employeeLock: EmployeeRowLockPort['lock'];
  readonly access: CommissionPlanAccessPort['recheck'];
}

async function reopenReviewed(
  tx: Tx,
  actor: CommissionPlanVersionActor,
  periods: readonly string[],
): Promise<void> {
  if (periods.length === 0) return;
  await tx.execute(sql`UPDATE commission_statements SET status='DRAFT',
    reviewed_fingerprint=NULL,reviewed_statement_fingerprint=NULL,reviewed_by=NULL,
    reviewed_membership_id=NULL,reviewed_at=NULL
    WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}
      AND status='REVIEWED' AND period IN (${sql.join(
        periods.map((period) => sql`${period}`),
        sql`, `,
      )})`);
}

export function createCommissionPlanVersionScope(
  tx: Tx,
  actor: CommissionPlanVersionActor,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
): CommissionPlanVersionScope {
  return {
    lockEmployee: () =>
      readers.employeeLock(tx, actor.companyId, actor.businessId, actor.employeeId),
    timeZone: () => readers.businessTimeZone(tx, actor.companyId, actor.businessId),
    firstStatementPeriod: async () => {
      const [row] = await tx.execute<{ period: string | null }>(sql`
        SELECT min(period) AS period FROM commission_statements
        WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}`);
      return row?.period ?? null;
    },
    lockPeriods: (periods) =>
      lockStatementPeriods(tx, { businessId: actor.businessId, periods, ids }),
    reopenReviewed: (periods) => reopenReviewed(tx, actor, periods),
    recheckAccess: () => readers.access(tx, actor.companyId, actor.userId, actor.businessId),
    latestVersion: async () => {
      const [row] = await tx.execute<{ version: number | null }>(sql`
        SELECT max(version) AS version FROM commission_plan_versions
        WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}
          AND employee_id=${actor.employeeId}`);
      return row?.version ?? null;
    },
    insert: (record) => insertPlanVersion(tx, actor.companyId, actor.businessId, record),
    audit: (record) => auditPlanVersion(tx, ids, record),
  };
}
