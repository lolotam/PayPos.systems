import { commissionClosedStatementView } from '@pospay/contracts';
import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
} from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type { CommissionStatementApproveTransactions } from '../ports/commission-statement-approve.port.ts';
import {
  createCommissionStatementApproveScope,
  type CommissionStatementApproveReaders,
} from './commission-statement-approve-scope.ts';
import { refuseAfterBusyClaim } from './refuse-after-busy-claim.ts';

const OPERATION = 'approve-commission-statement';

/**
 * يبني حد معاملة الاعتماد بنفس ترتيب كاتبي الخطة والإنشاء: فحص الصلاحية قبل المطالبة، ثم المطالبة idempotent،
 * وإعادة الفحص قبل أي رد مخزّن أو بعد تعارض المفتاح، وبعد انتهاء انتظار المفتاح بخطأ الانشغال بيتقرا في معاملة
 * منفصلة. إعادة الإرسال بنفس المفتاح والطلب بعد اعتماد ناجح مفقود الرد ترجع الرد الأصلي لا 409 (ADR-0054 §10 اختبار 12).
 * الرد يُبنى ويُتحقق من عقده داخل المعاملة قبل الالتزام: رد غير قابل للتمثيل يلغي الاعتماد كله بدل أن يُلتزم به ثم يفشل
 * في كل إعادة إرسال.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param ids مولّد المعرّفات لصفوف التجميد والمرحّلات والتدقيق
 * @param readers قراء الجذر المربوطة
 * @returns حد معاملة الاعتماد
 */
export function createCommissionStatementApproveTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionStatementApproveReaders,
): CommissionStatementApproveTransactions {
  const transactions: CommissionStatementApproveTransactions = {
    run: async (command, work) =>
      database.withTenant(
        command.companyId,
        async (tx) => {
          const scope = createCommissionStatementApproveScope(tx, command, ids, readers);
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
            async () => ({
              status: 200,
              body: commissionClosedStatementView.parse(await work(scope)),
            }),
          ).catch(async (error: unknown) => {
            if (error instanceof IdempotencyKeyReusedError) await assertAccess();
            throw error;
          });
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
        (tx) => createCommissionStatementApproveScope(tx, command, ids, readers),
      ),
  };
}
