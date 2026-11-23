import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
} from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionPlanVersionTransactions } from '../ports/commission-plan-version-transactions.port.ts';
import {
  createCommissionPlanVersionScope,
  type CommissionPlanVersionReaders,
} from './commission-plan-version-scope.ts';

const OPERATION = 'create-commission-plan-version';

export function createCommissionPlanVersionTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionPlanVersionReaders,
): CommissionPlanVersionTransactions {
  return {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionPlanVersionScope(tx, command, ids, readers);
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
}
