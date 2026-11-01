import { runIdempotent, type IdGenerator, type TenantWrappers } from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionServiceOverrideTransactions } from '../ports/commission-service-override-transactions.port.ts';
import {
  createCommissionServiceOverrideScope,
  type CommissionServiceOverrideReaders,
} from './commission-service-override-scope.ts';

const OPERATION = 'create-commission-service-override';

export function createCommissionServiceOverrideTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionServiceOverrideReaders,
): CommissionServiceOverrideTransactions {
  return {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionServiceOverrideScope(tx, command, ids, readers);
          // الصلاحية بتتأكد قبل مطالبة المفتاح، فالمحفوظ كمان بيرفض لو سحبت الصلاحية بعده.
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
          return result.body as Awaited<ReturnType<typeof work>>;
        },
        { userId: command.userId },
      ),
  };
}
