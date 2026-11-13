import { lockStatementPeriods, type Tx } from '@pospay/db';

import type { CommissionPeriodLockInput } from '../ports/commission-line-projection.port.ts';

export async function lockCommissionPeriods(tx: Tx, input: CommissionPeriodLockInput) {
  const locked = await lockStatementPeriods(tx, {
    businessId: input.businessId,
    periods: input.periods,
    ids: input.ids,
  });
  return locked.map((row) => ({
    period: row.period,
    statementId: row.statementId,
    status: row.status,
  }));
}
