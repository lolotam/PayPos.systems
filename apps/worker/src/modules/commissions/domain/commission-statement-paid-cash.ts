import type { Money } from '@pospay/domain';

/** صف صرف مخزّن لموظفة؛ المبلغ هو المدفوع كاش بعد التقريب لأقرب 5 فلوس. */
export interface CommissionStatementStoredPayment {
  readonly employeeId: string;
  readonly amount: Money;
}

/** الصف المكفي من المجمّد لتحديد الموظفة المرئية وهل شهرها جزئي. */
export interface CommissionStatementPaidCashRow {
  readonly employeeId: string;
  readonly partial: boolean;
}

/** نتيجة اختيار الكاش المدفوع: الأرقام المسموح بظهورها، وهل ناقص صف صرف لموظفة شهرها كامل. */
export interface CommissionStatementPaidCashSelection {
  readonly paidCash: readonly CommissionStatementStoredPayment[];
  readonly missingEmployeeIds: readonly string[];
}

/**
 * بيختار أرقام الكاش المدفوع اللي تظهر في ملف تصدير كشف مدفوع بطريقة CASH.
 * الموظفة الجزئية (شهرها فيه صفوف برّه فروع الطلب) بيتحجب رقمها بالكامل، لأن المبلغ المدفوع
 * ليه شهرها كله ومفيش صيغة معتمدة لتجزئته (CS-Q23)، فنخفيه بدل ما نكشف رقم الشهر الكامل لقارئ فرع.
 *
 * @param rows الصفوف المرئية للطلب بعد فلتر النطاق، وفيها علامة الجزئي لكل موظفة
 * @param payments صفوف الصرف المخزّنة للكشف كله
 * @returns الكاش المدفوع لموظفات الشهر الكامل المرئيات بس، ومعرّفات اللي ناقص ليها صف صرف
 */
export function selectCommissionStatementPaidCash(
  rows: readonly CommissionStatementPaidCashRow[],
  payments: readonly CommissionStatementStoredPayment[],
): CommissionStatementPaidCashSelection {
  const fullMonth = new Set<string>();
  const partial = new Set<string>();
  for (const row of rows) {
    if (row.partial) partial.add(row.employeeId);
    else fullMonth.add(row.employeeId);
  }
  // TODO(spec): CS-Q23 وplan-56-1b.md ما بيحددوش صيغة كاش مدفوع للموظفة الجزئية، فرقم شهرها الكامل بيتحجب بدل ما يتكشف لقارئ الفرع.
  for (const employeeId of partial) fullMonth.delete(employeeId);
  const stored = new Map(payments.map((payment) => [payment.employeeId, payment]));
  const paidCash: CommissionStatementStoredPayment[] = [];
  const missingEmployeeIds: string[] = [];
  for (const employeeId of fullMonth) {
    const payment = stored.get(employeeId);
    if (payment === undefined) missingEmployeeIds.push(employeeId);
    else paidCash.push(payment);
  }
  return { paidCash, missingEmployeeIds };
}
