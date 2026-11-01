import { sql } from 'drizzle-orm';
import type { IdGenerator, Tx } from '@pospay/db';

import type {
  CommissionPlanVersionActor,
  CommissionPlanVersionScope,
} from '../ports/commission-plan-version-transactions.port.ts';
import {
  createCommissionInputLockScope,
  type CommissionInputLockReaders,
} from './commission-input-lock-scope.ts';
import { auditPlanVersion, insertPlanVersion } from './commission-plan-version-writer.ts';

/** قراء Plan version بيستعملهم قارئ القفل المشترك نفسه. */
export type CommissionPlanVersionReaders = CommissionInputLockReaders;

export function createCommissionPlanVersionScope(
  tx: Tx,
  actor: CommissionPlanVersionActor,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
): CommissionPlanVersionScope {
  return {
    ...createCommissionInputLockScope(tx, actor, ids, readers),
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
