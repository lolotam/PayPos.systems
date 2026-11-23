import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
} from '@pospay/db';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionPeriodRepairTransactions } from '../ports/commission-period-repair-transactions.port.ts';
import { createCommissionPeriodRepairScope } from './commission-period-repair-scope.ts';
import type { CommissionPlanVersionReaders } from './commission-plan-version-scope.ts';
import { refuseAfterBusyClaim } from './refuse-after-busy-claim.ts';

const OPERATION = 'repair-commission-period';

export function createCommissionPeriodRepairTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
  clock: Clock,
): CommissionPeriodRepairTransactions {
  const transactions: CommissionPeriodRepairTransactions = {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionPeriodRepairScope(tx, command, ids, readers, clock);
          const assertAccess = async () => {
            const failure = await scope.recheckAccess();
            if (failure !== null) throw new CommissionPlanVersionError(failure);
          };
          await assertAccess();
          const result = await runIdempotent(
            tx,
            {
              scope: 'COMPANY',
              operation: OPERATION,
              key: command.key,
              fingerprint: command.fingerprint,
            },
            async () => ({ status: 201, body: await work(scope) }),
          ).catch(async (error: unknown) => {
            // طلب مختلف على نفس المفتاح بعد الانتظار: الـ 403 الموحّد بيسبق تعارض المفتاح.
            if (error instanceof IdempotencyKeyReusedError) await assertAccess();
            throw error;
          });
          // الرد المخزّن ممكن يرجع بعد انتظار على نفس المفتاح، فالصلاحية بتتفحص تاني قبل ما نرجّعه.
          if (result.replayed) await assertAccess();
          return result.body as Awaited<ReturnType<typeof work>>;
        },
        { userId: command.userId },
      ),
  };
  return {
    run: (command, work) =>
      refuseAfterBusyClaim(
        database,
        command,
        () => transactions.run(command, work),
        (tx) => createCommissionPeriodRepairScope(tx, command, ids, readers, clock),
      ),
  };
}
