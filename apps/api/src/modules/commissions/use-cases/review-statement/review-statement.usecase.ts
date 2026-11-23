import type { CommissionStatementReviewResult } from '@pospay/contracts';
import { sessionBusinessDate } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import { isStatementPeriodEnded } from '../../domain/statement-period.ts';
import { planCommissionStatementReview } from '../../domain/statement-review-plan.ts';
import type {
  CommissionStatementReviewCommand,
  CommissionStatementReviewScope,
  CommissionStatementReviewTransactions,
} from '../../ports/commission-statement-review.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';
import { computeStatement } from '../compute-statement-view/compute-statement-view.ts';

/** يراجع كشف شهر: يثبّت حالته REVIEWED ببصمتيه ويبعت إشعار الاعتماد (FR-029). */
export class ReviewCommissionStatementUseCase {
  constructor(
    private readonly transactions: CommissionStatementReviewTransactions,
    private readonly hasher: FingerprintHasher,
    private readonly clock: Clock,
  ) {}

  /**
   * @param command هوية الفاعل والشهر والبصمتان المتوقعتان ومفتاح إعادة الإرسال
   * @returns حالة الكشف المراجَع وبصمتاه
   */
  execute(command: CommissionStatementReviewCommand): Promise<CommissionStatementReviewResult> {
    return this.transactions.run(command, (scope) =>
      reviewStatement(scope, command, this.hasher, this.clock),
    );
  }
}

/**
 * الخطوات بترتيبها الإلزامي: فحص انتهاء الشهر قبل أي قفل، قفل الشهر مع رفض APPROVED وPAID، إعادة
 * فحص الصلاحية بعد القفل، قراءة المصادر، حساب البصمتين، ثم خطة المراجعة: الكشف لازم يكون مسودة،
 * ومفيش مشكلة بتمنع المراجعة، والبصمتان لازم تطابق اللي المراجع شافها. أي خطأ بيلغي كل اللي اتكتب.
 *
 * @param scope خطوات الكتابة على المعاملة
 * @param command هوية الفاعل والشهر والبصمتان المتوقعتان
 * @param hasher منفذ التجزئة
 * @param clock ساعة الشهر الحالي
 * @returns حالة الكشف المراجَع وبصمتاه
 */
export async function reviewStatement(
  scope: CommissionStatementReviewScope,
  command: CommissionStatementReviewCommand,
  hasher: FingerprintHasher,
  clock: Clock,
): Promise<CommissionStatementReviewResult> {
  const { period } = command;
  const timeZone = await scope.timeZone();
  if (timeZone === null) throw new CommissionPlanVersionError('FORBIDDEN');
  if (!isStatementPeriodEnded(period, sessionBusinessDate(clock.now(), timeZone))) {
    throw new CommissionPlanVersionError('COMMISSION_PERIOD_NOT_ENDED');
  }
  await scope.lockPeriod(period);
  const failure = await scope.recheckAccess();
  if (failure !== null) throw new CommissionPlanVersionError(failure);
  const source = await scope.readSource(period);
  const computed = computeStatement(period, source, hasher);
  const membershipId = await scope.actorMembership();
  if (membershipId === null) throw new CommissionPlanVersionError('FORBIDDEN');
  const plan = planCommissionStatementReview({
    statementId: scope.lockedStatementId(),
    status: source.statement?.status ?? 'DRAFT',
    actorUserId: command.userId,
    actorMembershipId: membershipId,
    recordedAt: clock.now(),
    expectedFingerprint: command.expectedFingerprint,
    expectedStatementFingerprint: command.expectedStatementFingerprint,
    currentFingerprint: computed.inputFingerprint,
    currentStatementFingerprint: computed.statementFingerprint,
    pricingFailures: computed.build.failures,
    blockedCorrections: source.blocked,
  });
  if (plan.kind === 'NOT_DRAFT') throw new CommissionPlanVersionError('COMMISSION_PERIOD_NOT_DRAFT');
  if (plan.kind === 'BLOCKED') {
    throw new CommissionPlanVersionError('COMMISSION_STATEMENT_BLOCKED', {
      issues: plan.issues.map((issue) => ({ employee_id: issue.employeeId, code: issue.code })),
    });
  }
  if (plan.kind === 'STALE') {
    throw new CommissionPlanVersionError('COMMISSION_FINGERPRINT_STALE', {
      current_fingerprint: plan.currentFingerprint,
      current_statement_fingerprint: plan.currentStatementFingerprint,
      changed: plan.changed,
      return_required: false,
    });
  }
  await scope.storeReview(period, plan.transition);
  await scope.auditReview(period, {
    input: plan.transition.review.fingerprint,
    statement: plan.transition.review.statementFingerprint,
  });
  await scope.notifyApprovers(period, command.businessId);
  return {
    status: 'REVIEWED',
    reviewed_fingerprint: plan.transition.review.fingerprint,
    reviewed_statement_fingerprint: plan.transition.review.statementFingerprint,
  };
}
