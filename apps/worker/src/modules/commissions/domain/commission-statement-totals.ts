import { sumMoney, type Money } from '@pospay/domain';

/** أنواع بنود كشف العمولة المجمّدة؛ نفس ترتيب البنود في العقد. */
export type CommissionStatementRowKind =
  | 'COMMISSION'
  | 'SALE'
  | 'TIP_CARD'
  | 'TIP_CASH'
  | 'CORRECTION'
  | 'CORRECTION_TIP_CARD'
  | 'CORRECTION_TIP_CASH'
  | 'CARRY_COMMISSION'
  | 'CARRY_TIP_CARD'
  | 'EMPLOYEE';

/** صف واحد يدخل في التلخيص: هوية الموظفة ونوع البند ومبلغه. */
export interface CommissionStatementSummaryRow {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly employeeNameAr: string | null;
  readonly employeeNameEn: string;
  readonly kind: CommissionStatementRowKind;
  readonly amount: Money;
  readonly partial: boolean;
}

/** إجمالي موظفة واحدة في ورقة الملخص؛ مبالغ بالفلوس (ألف من الدينار). */
export interface CommissionStatementEmployeeTotal {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly employeeNameAr: string | null;
  readonly employeeNameEn: string;
  readonly commission: Money;
  readonly salesCommission: Money;
  readonly corrections: Money;
  readonly cardTips: Money;
  readonly cashTips: Money;
  readonly netPayable: Money;
  readonly partial: boolean;
}

interface MutableEmployee {
  employeeId: string;
  employeeNumber: number;
  employeeNameAr: string | null;
  employeeNameEn: string;
  partial: boolean;
  commission: Money[];
  sales: Money[];
  corrections: Money[];
  cardTips: Money[];
  cashTips: Money[];
}

/**
 * الجانب السالب بيتقفل عند صفر؛ الصافي ما بياخدش سالب (CS-Q7).
 *
 * @param value المبلغ بالفلوس
 * @returns المبلغ نفسه لو كان صفر أو أكتر، وصفر لو كان سالب
 */
function nonNegative(value: Money): Money {
  return value < 0n ? 0n : value;
}

/**
 * كل بند بيروح في إجماليه: التصحيح والرصيد المرحّل على جانب العمولة، والكاش للعلم بس.
 *
 * @param employee إجمالي الموظفة اللي بيتجمّع فيها
 * @param row الصف المجمّد ونوعه ومبلغه
 */
function collect(employee: MutableEmployee, row: CommissionStatementSummaryRow): void {
  if (row.kind === 'COMMISSION') employee.commission.push(row.amount);
  if (row.kind === 'SALE') employee.sales.push(row.amount);
  if (row.kind === 'CORRECTION' || row.kind === 'CARRY_COMMISSION') {
    employee.corrections.push(row.amount);
  }
  if (
    row.kind === 'TIP_CARD' ||
    row.kind === 'CORRECTION_TIP_CARD' ||
    row.kind === 'CARRY_TIP_CARD'
  ) {
    employee.cardTips.push(row.amount);
  }
  if (row.kind === 'TIP_CASH' || row.kind === 'CORRECTION_TIP_CASH') {
    employee.cashTips.push(row.amount);
  }
}

/**
 * يبني إجمالي الموظفة: جانب العمولة و جانب بقشيش الكارت ما بيتخصموش من بعض، والكاش مش داخل الصافي.
 *
 * @param employee مجاميع بنود الموظفة اللي اتجمّعت
 * @returns إجمالي الموظفة جاهز للعرض
 */
function total(employee: MutableEmployee): CommissionStatementEmployeeTotal {
  const commission = sumMoney(employee.commission);
  const salesCommission = sumMoney(employee.sales);
  const corrections = sumMoney(employee.corrections);
  const cardTips = sumMoney(employee.cardTips);
  const commissionSide = sumMoney([commission, salesCommission, corrections]);
  return {
    employeeId: employee.employeeId,
    employeeNumber: employee.employeeNumber,
    employeeNameAr: employee.employeeNameAr,
    employeeNameEn: employee.employeeNameEn,
    commission,
    salesCommission,
    corrections,
    cardTips,
    cashTips: sumMoney(employee.cashTips),
    netPayable: sumMoney([nonNegative(commissionSide), nonNegative(cardTips)]),
    partial: employee.partial,
  };
}

/**
 * يجمّع الصفوف المجمّدة لكل موظفة ويحسب إجمالياتها وصافيها.
 * القاعدة: جانب العمولة (عمولة + بيع + تصحيحات) ما بيتخصمش من جانب بقشيش الكارت،
 * وكل جانب لو طلع سالب بيتقفل عند صفر، وبقشيش الكاش للعلم بس ومش داخل الصافي.
 *
 * @param rows الصفوف المجمّدة بعد ترشيح نطاق القارئ
 * @returns إجمالي واحد لكل موظفة، بنفس ترتيب أول ظهور لكل موظفة
 */
export function summarizeCommissionStatement(
  rows: readonly CommissionStatementSummaryRow[],
): CommissionStatementEmployeeTotal[] {
  const employees = new Map<string, MutableEmployee>();
  for (const row of rows) {
    const current = employees.get(row.employeeId) ?? {
      employeeId: row.employeeId,
      employeeNumber: row.employeeNumber,
      employeeNameAr: row.employeeNameAr,
      employeeNameEn: row.employeeNameEn,
      partial: row.partial,
      commission: [],
      sales: [],
      corrections: [],
      cardTips: [],
      cashTips: [],
    };
    collect(current, row);
    employees.set(row.employeeId, current);
  }
  return [...employees.values()].map(total);
}
