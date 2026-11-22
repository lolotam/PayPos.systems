import { runIdempotent, type IdGenerator, type TenantWrappers } from '@pospay/db';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionPeriodRepairTransactions } from '../ports/commission-period-repair-transactions.port.ts';
import { createCommissionPeriodRepairScope } from './commission-period-repair-scope.ts';
import type { CommissionPlanVersionReaders } from './commission-plan-version-scope.ts';

const OPERATION = 'repair-commission-period';

export function createCommissionPeriodRepairTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
  clock: Clock,
): CommissionPeriodRepairTransactions {
  return {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionPeriodRepairScope(tx, command, ids, readers, clock);
          const accessFailure = await scope.recheckAccess();
          if (accessFailure !== null) {
            throw new CommissionPlanVersionError(accessFailure);
          }
          const result = await runIdempotent(
            tx,
            {
              scope: 'COMPANY',
              operation: OPERATION,
              key: command.key,
              fingerprint: command.fingerprint,
            },
            async () => ({ status: 201, body: await work(scope) }),
          );
          // الرد المخزّن ممكن يرجع بعد انتظار على نفس المفتاح، فالصلاحية بتتفحص تاني قبل ما نرجّعه.
          if (result.replayed) {
            const replayFailure = await scope.recheckAccess();
            if (replayFailure !== null) throw new CommissionPlanVersionError(replayFailure);
          }
          return result.body as Awaited<ReturnType<typeof work>>;
        },
        { userId: command.userId },
      ),
  };
}
