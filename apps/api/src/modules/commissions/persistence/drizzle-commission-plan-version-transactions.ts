import {
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
