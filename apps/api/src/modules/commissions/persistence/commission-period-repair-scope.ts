import { appendAuditLog, appendOutboxEvent, type IdGenerator, type Tx } from '@pospay/db';
import { createCommissionCorrectionScope } from '@pospay/commissions-posting';
import { sql } from 'drizzle-orm';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import type {
  CommissionPeriodRepairScope,
  CommissionRepairBlockState,
  CommissionRepairOpenBlock,
  CommissionRepairVersion,
} from '../ports/commission-period-repair-transactions.port.ts';
import type { CommissionPlanVersionActor } from '../ports/commission-plan-version-transactions.port.ts';
import {
  createCommissionPlanVersionScope,
  type CommissionPlanVersionReaders,
} from './commission-plan-version-scope.ts';

type OpenBlockRow = {
  id: string;
  code: CommissionRepairOpenBlock['code'];
  first_event_id: string;
};
type BlockStateRow = { id: string; code: CommissionRepairBlockState['code']; resolved: boolean };

export function createCommissionPeriodRepairScope(
  tx: Tx,
  actor: CommissionPlanVersionActor,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
  clock: Clock,
): CommissionPeriodRepairScope {
  return {
    ...createCommissionPlanVersionScope(tx, actor, ids, readers),
    readOpenBlock: async (period) => {
      const [row] = await tx.execute<OpenBlockRow>(sql`
        SELECT id::text AS id, code, first_event_id::text AS first_event_id
        FROM commission_blocked_corrections
        WHERE company_id=${actor.companyId} AND business_id=${actor.businessId}
          AND employee_id=${actor.employeeId} AND source_period=${period} AND resolved_at IS NULL`);
      return row === undefined
        ? null
        : { id: row.id, code: row.code, firstEventId: row.first_event_id };
    },
    corrections: () => createCommissionCorrectionScope(tx, ids, clock),
    readBlock: async (blockId): Promise<CommissionRepairBlockState> => {
      const [row] = await tx.execute<BlockStateRow>(sql`
        SELECT id::text AS id, code, resolved_at IS NOT NULL AS resolved
        FROM commission_blocked_corrections
        WHERE company_id=${actor.companyId} AND id=${blockId}`);
      if (row === undefined) throw new Error('The repaired blocked correction is gone');
      return row;
    },
    outbox: { append: (event) => appendOutboxEvent(tx, ids.newId(), event) },
    audit: (record: CommissionRepairVersion, block) =>
      appendAuditLog(tx, ids.newId(), {
        entity: 'commission_plan',
        entityId: record.id,
        action: 'commission_plan.period_repaired',
        after: { ...record, blocked_correction: block },
      }),
  };
}
