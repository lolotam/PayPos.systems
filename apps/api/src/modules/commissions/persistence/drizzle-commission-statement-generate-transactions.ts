import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
} from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionStatementGenerateTransactions } from '../ports/commission-statement.port.ts';
import {
  createCommissionStatementGenerateScope,
  type CommissionStatementGenerateReaders,
} from './commission-statement-generate-scope.ts';
import { refuseAfterBusyClaim } from './refuse-after-busy-claim.ts';

const OPERATION = 'generate-commission-statement';

/**
 * يبني حد معاملة الإنشاء: فحص الصلاحية قبل المطالبة، ثم المطالبة idempotent، وإعادة الفحص قبل أي رد
 * مخزّن أو بعد تعارض المفتاح، وبعد انتهاء انتظار المفتاح بخطأ الانشغال بيتقرا في معاملة منفصلة؛ نفس
 * شكل كاتبي الخطة والإصلاح، علشان سحب الصلاحية ما يخليش رد قديم يتسرّب.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param ids مولّد المعرّفات لصف الكشف الجديد وإدخال التدقيق
 * @param readers قراء التقويم والصلاحية والمصادر
 * @returns حد معاملة الإنشاء
 */
export function createCommissionStatementGenerateTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionStatementGenerateReaders,
): CommissionStatementGenerateTransactions {
  const transactions: CommissionStatementGenerateTransactions = {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionStatementGenerateScope(tx, command, ids, readers);
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
        (tx) => createCommissionStatementGenerateScope(tx, command, ids, readers),
      ),
  };
}
