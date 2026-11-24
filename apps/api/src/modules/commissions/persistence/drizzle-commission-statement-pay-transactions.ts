import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
} from '@pospay/db';

import { CommissionStatementPayError } from '../domain/errors.ts';
import type {
  CommissionStatementPayTransactions,
} from '../ports/commission-statement-pay-transactions.port.ts';
import { createCommissionStatementPayScope, type CommissionStatementPayReaders } from './commission-statement-pay-scope.ts';
import { refuseAfterBusyClaim } from './refuse-after-busy-claim.ts';

const OPERATION = 'mark-statement-paid';

export function createCommissionStatementPayTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionStatementPayReaders,
): CommissionStatementPayTransactions {
  const transactions: CommissionStatementPayTransactions = {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionStatementPayScope(tx, command, ids, readers);
          const assertAccess = async () => {
            const failure = await scope.recheckAccess();
            if (failure !== null) throw new CommissionStatementPayError(failure);
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
            async () => ({ status: 200, body: await work(scope) }),
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
        (tx) => createCommissionStatementPayScope(tx, command, ids, readers),
        (failure) => new CommissionStatementPayError(failure),
      ),
  };
}
