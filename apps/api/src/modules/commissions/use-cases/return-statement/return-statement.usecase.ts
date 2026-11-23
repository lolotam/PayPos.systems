import type { CommissionStatementReturnResult } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import { planCommissionStatementReturn } from '../../domain/statement-return-plan.ts';
import type {
  CommissionStatementReturnCommand,
  CommissionStatementReviewScope,
  CommissionStatementReviewTransactions,
} from '../../ports/commission-statement-review.port.ts';

/** يرجّع كشفاً مراجَعاً إلى المسودة ويسجّل سبب الإرجاع (FR-031). */
export class ReturnCommissionStatementUseCase {
  constructor(
    private readonly transactions: CommissionStatementReviewTransactions,
    private readonly clock: Clock,
  ) {}

  /**
   * @param command هوية الفاعل والشهر والسبب ومفتاح إعادة الإرسال
   * @returns حالة الكشف بعد الرجوع للمسودة
   */
  execute(command: CommissionStatementReturnCommand): Promise<CommissionStatementReturnResult> {
    return this.transactions.runReturn(command, (scope) =>
      returnStatement(scope, command, this.clock),
    );
  }
}

/**
 * الخطوات بترتيبها الإلزامي: قفل الشهر مع رفض APPROVED وPAID، إعادة فحص الصلاحية بعد القفل (صاحب
 * مراجعة أو صاحب اعتماد، وقارئ على مستوى النشاط كله)، قراءة حالة الكشف، ثم خطة الإرجاع: الإرجاع
 * مسموح لحالة REVIEWED وحدها. السبب بيتحقق في العقد ويتنضّد هنا، وهو يعيش في سطر الإرجاع وحده
 * فمفيش سبب في حدث ولا في نص تدقيق ولا في سجل تشغيلي.
 *
 * @param scope خطوات الكتابة على المعاملة
 * @param command هوية الفاعل والشهر والسبب
 * @param clock ساعة اللحظة الحالية
 * @returns حالة الكشف بعد الرجوع للمسودة
 */
export async function returnStatement(
  scope: CommissionStatementReviewScope,
  command: CommissionStatementReturnCommand,
  clock: Clock,
): Promise<CommissionStatementReturnResult> {
  const { period } = command;
  const reason = command.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new CommissionPlanVersionError('COMMISSION_RETURN_REASON_INVALID');
  }
  await scope.lockPeriod(period);
  const failure = await scope.recheckAccess();
  if (failure !== null) throw new CommissionPlanVersionError(failure);
  const source = await scope.readSource(period);
  const membershipId = await scope.actorMembership();
  if (membershipId === null) throw new CommissionPlanVersionError('FORBIDDEN');
  const plan = planCommissionStatementReturn({
    statementId: scope.lockedStatementId(),
    status: source.statement?.status ?? 'DRAFT',
    actorUserId: command.userId,
    actorMembershipId: membershipId,
    recordedAt: clock.now(),
    normalizedReason: reason,
  });
  if (plan.kind === 'NOT_REVIEWED') {
    throw new CommissionPlanVersionError('COMMISSION_STATEMENT_NOT_REVIEWED');
  }
  await scope.storeReturn(period, plan.transition);
  await scope.storeReturnRecord(plan.privateReturn);
  await scope.auditReturn(period);
  return { status: 'DRAFT' };
}
