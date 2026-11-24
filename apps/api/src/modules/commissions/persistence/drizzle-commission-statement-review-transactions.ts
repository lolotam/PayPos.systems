import {
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import type {
  CommissionStatementReturnCommand,
  CommissionStatementReviewCommand,
  CommissionStatementReviewScope,
  CommissionStatementReviewTransactions,
} from '../ports/commission-statement-review.port.ts';
import {
  createCommissionStatementReviewScope,
  type CommissionStatementReviewActor,
  type CommissionStatementReviewReaders,
} from './commission-statement-review-scope.ts';
import { refuseAfterBusyClaim } from './refuse-after-busy-claim.ts';

const REVIEW_OPERATION = 'review-commission-statement';
const RETURN_OPERATION = 'return-commission-statement';

/** أمر واحد من المراجعة أو الإرجاع؛ الفرق فيهم العملية والفحص بس. */
type StatementCommand = CommissionStatementReviewCommand | CommissionStatementReturnCommand;

/** كل ما حد المعاملة بيحتاجه: الداتابيز، ومولّد المعرّفات، والقراء. */
interface ReviewTransactionsContext {
  readonly database: TenantWrappers;
  readonly ids: IdGenerator;
  readonly readers: CommissionStatementReviewReaders;
}

/**
 * يبني حد معاملة المراجعة والإرجاع: فحص الصلاحية قبل المطالبة، ثم المطالبة idempotent، وإعادة
 * الفحص قبل أي رد مخزّن أو بعد تعارض المفتاح، وبعد انتهاء انتظار المفتاح بخطأ الانشغال بيتقرا في
 * معاملة منفصلة؛ نفس شكل كاتبي الكشف والإصلاح، علشان سحب الصلاحية ما يخليش رد قديم يتسرّب.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param ids مولّد المعرّفات لصف الإرجاع والتدقيق والحدث
 * @param readers القراء والمزودون
 * @returns حد معاملة المراجعة والإرجاع
 */
export function createCommissionStatementReviewTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: CommissionStatementReviewReaders,
): CommissionStatementReviewTransactions {
  const context: ReviewTransactionsContext = { database, ids, readers };
  return {
    run: (command, work) =>
      refuseAfterBusyClaim(
        database,
        command,
        () => claimStatement(context, command, 'review', work),
        (tx) => scopeOf(context, tx, command, 'review'),
      ),
    runReturn: (command, work) =>
      refuseAfterBusyClaim(
        database,
        command,
        () => claimStatement(context, command, 'return', work),
        (tx) => scopeOf(context, tx, command, 'return'),
      ),
  };
}

/** خطوة الكتابة على معاملة الشركة للفاعل ونوع العملية. */
function scopeOf(
  context: ReviewTransactionsContext,
  tx: Tx,
  command: StatementCommand,
  kind: 'review' | 'return',
): CommissionStatementReviewScope {
  const actor: CommissionStatementReviewActor = {
    companyId: command.companyId,
    userId: command.userId,
    businessId: command.businessId,
  };
  return createCommissionStatementReviewScope(
    { tx, ids: context.ids, readers: context.readers, actor },
    kind,
  );
}

/**
 * المطالبة على معاملة الشركة: فحص الصلاحية، ثم المطالبة idempotent، ثم إعادة الفحص قبل أي رد
 * مخزّن أو بعد تعارض المفتاح.
 */
async function claimStatement<T>(
  context: ReviewTransactionsContext,
  command: StatementCommand,
  kind: 'review' | 'return',
  work: (scope: CommissionStatementReviewScope) => Promise<T>,
): Promise<T> {
  const { database } = context;
  return database.withTenant(
    command.companyId,
    async (tx) => {
      const scope = scopeOf(context, tx, command, kind);
      const assertAccess = async () => {
        const failure = await scope.recheckAccess();
        if (failure !== null) throw new CommissionPlanVersionError(failure);
      };
      await assertAccess();
      const result = await runIdempotent(
        tx,
        {
          scope: 'COMPANY',
          operation: kind === 'review' ? REVIEW_OPERATION : RETURN_OPERATION,
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
  );
}
