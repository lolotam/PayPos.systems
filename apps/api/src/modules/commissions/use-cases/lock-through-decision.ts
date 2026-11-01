import { localDate } from '@pospay/i18n';

import type { Clock } from '../../../shared/ports/clock.port.ts';
import {
  assertCommissionPlanDateBeforeLocks,
  commissionPlanMonthsStillToLock,
  commissionPlanMonthsToLock,
  type CommissionPlanStatementPeriod,
} from '../domain/plan-periods.ts';

/** تاريخ السريان ونوعه، لأن كاتب الإصدار وكاتب التجاوز بيقرروا بنفس القاعدة. */
export interface LockThroughDecisionInput {
  readonly effectiveFrom: string;
  readonly wholePeriod: boolean;
}

/** القفل المطلوب من النطاق: قفل الشهور بس، لأنه القفل المشترك بين الكاتبين. */
export interface LockThroughDecisionScope {
  lockPeriods(periods: readonly string[]): Promise<CommissionPlanStatementPeriod[]>;
}

/** نتيجة القرار: الشهور المقفلة ولحظة القرار. */
export interface LockThroughDecisionResult {
  readonly locked: CommissionPlanStatementPeriod[];
  readonly decidedAt: Date;
}

/**
 * يمرّ بقرار السريان من أول قفل لآخره: يرفض التاريخ الماضي قبل أي قفل، ثم يقفل الشهور تصاعدياً،
 * ويعيد عينة الساعة بعد كل انتظار عشان الشهر اللي وصل أثناء الانتظار ياخد قفله قبل أي كتابة.
 *
 * @param scope القفل المشترك بين كاتب الإصدار وكاتب التجاوز
 * @param input تاريخ السريان وهل يغطي شهره بالكامل
 * @param calendar توقيت النشاط وتاريخ إنشائه
 * @param clock ساعة محقونة بتحدد اليوم المحلي ولحظة القرار
 * @returns الشهور المقفلة ولحظة القرار بعد آخر انتظار
 */
export async function lockThroughDecision(
  scope: LockThroughDecisionScope,
  input: LockThroughDecisionInput,
  calendar: { readonly timeZone: string; readonly createdAt: Date },
  clock: Clock,
): Promise<LockThroughDecisionResult> {
  const today = localDate(clock.now(), calendar.timeZone);
  assertCommissionPlanDateBeforeLocks({
    effectiveFrom: input.effectiveFrom,
    wholePeriod: input.wholePeriod,
    today,
    businessStartMonth: localDate(calendar.createdAt, calendar.timeZone).slice(0, 7),
  });
  const locked = await scope.lockPeriods(commissionPlanMonthsToLock(input.effectiveFrom, today));
  let decidedAt = clock.now();
  while (true) {
    const missing = commissionPlanMonthsStillToLock(
      input.effectiveFrom,
      localDate(decidedAt, calendar.timeZone),
      locked.map(({ period }) => period),
    );
    if (missing.length === 0) return { locked, decidedAt };
    locked.push(...(await scope.lockPeriods(missing)));
    decidedAt = clock.now();
  }
}
