import type { CommissionStatementView } from '@pospay/contracts';
import { sessionBusinessDate } from '@pospay/domain';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { CommissionPlanVersionError } from '../../domain/errors.ts';
import { isStatementPeriodEnded } from '../../domain/statement-period.ts';
import type {
  CommissionStatementGenerateCommand,
  CommissionStatementGenerateScope,
  CommissionStatementGenerateTransactions,
} from '../../ports/commission-statement.port.ts';
import type { FingerprintHasher } from '../../ports/fingerprint-hasher.port.ts';
import { computeStatement } from '../compute-statement-view/compute-statement-view.ts';
import { businessViewContract } from '../compute-statement-view/statement-view-contract.ts';

/** ينشئ كشف شهر انتهى: يقفل الشهر، ويحسب الكشف وبصمتيه، ويخزّن بصمة المدخلات ويرجّع العرض كله (FR-025). */
export class GenerateCommissionStatementUseCase {
  constructor(
    private readonly transactions: CommissionStatementGenerateTransactions,
    private readonly hasher: FingerprintHasher,
    private readonly clock: Clock,
  ) {}

  /**
   * @param command الفاعل والنشاط والشهر ومفتاح إعادة الإرسال
   * @returns عرض الكشف لقارئ النشاط كله، بعد ما بصمته اتخزنت
   */
  execute(command: CommissionStatementGenerateCommand): Promise<CommissionStatementView> {
    return this.transactions.run(command, (scope) =>
      generateStatement(scope, command, this.hasher, this.clock),
    );
  }
}

/**
 * الخطوات بترتيبها الإلزامي: فحص انتهاء الشهر قبل أي قفل (قاعدة تقويم مش حالة بتتغيّر، والقفل بينشئ صف
 * كشف فميصحش لشهر لسه ما خلصش)، قفل الشهر مع رفض APPROVED وPAID، إعادة فحص الصلاحية بعد القفل، قراءة
 * المصادر، حساب الكشف، تخزين بصمة المدخلات وحدها، ثم التدقيق. على كشف REVIEWED بيتخزّن بصمة المدخلات
 * الحالية بس، والحالة وبيانات المراجعة ما بتتلمسش (D-5، FR-029). أي خطأ بيلغي كل اللي اتكتب.
 *
 * @param scope خطوات الكتابة على المعاملة
 * @param command الفاعل والنشاط والشهر
 * @param hasher منفذ التجزئة
 * @param clock ساعة الشهر الحالي
 * @returns عرض الكشف بعد التخزين
 */
export async function generateStatement(
  scope: CommissionStatementGenerateScope,
  command: CommissionStatementGenerateCommand,
  hasher: FingerprintHasher,
  clock: Clock,
): Promise<CommissionStatementView> {
  const { period, businessId } = command;
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
  await scope.storeCurrentFingerprint(period, computed.inputFingerprint);
  await scope.audit(period, {
    input: computed.inputFingerprint,
    statement: computed.statementFingerprint,
  });
  return businessViewContract({
    businessId,
    period,
    source: {
      ...source,
      statement:
        source.statement === null
          ? null
          : { ...source.statement, currentFingerprint: computed.inputFingerprint },
    },
    computed,
    scope: { businessWide: true, branchIds: [] },
  });
}
