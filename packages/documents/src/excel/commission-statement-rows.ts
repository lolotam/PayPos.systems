import { sumMoney, type Money } from '@pospay/domain';

export const COMMISSION_STATEMENT_ROW_KINDS = [
  'COMMISSION',
  'SALE',
  'TIP_CARD',
  'TIP_CASH',
  'CORRECTION',
  'CORRECTION_TIP_CARD',
  'CORRECTION_TIP_CASH',
  'CARRY_COMMISSION',
  'CARRY_TIP_CARD',
  'EMPLOYEE',
] as const;

export type CommissionStatementRowKind = (typeof COMMISSION_STATEMENT_ROW_KINDS)[number];

export interface CommissionStatementWorkbookRow {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly employeeNameAr: string | null;
  readonly employeeNameEn: string;
  readonly kind: CommissionStatementRowKind;
  readonly amount: Money;
  readonly previousAmount: Money | null;
  readonly newAmount: Money | null;
  readonly sourcePeriod: string | null;
  readonly businessDate: string | null;
  readonly serviceNameAr: string | null;
  readonly serviceNameEn: string | null;
  readonly customerName: string | null;
  readonly partial: boolean;
}

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

interface MutableEmployeeRows {
  readonly row: CommissionStatementWorkbookRow;
  readonly commission: Money[];
  readonly sales: Money[];
  readonly corrections: Money[];
  readonly cardTips: Money[];
  readonly cashTips: Money[];
}

function nonNegative(value: Money): Money {
  return value < 0n ? 0n : value;
}

function total(rows: MutableEmployeeRows): CommissionStatementEmployeeTotal {
  const commission = sumMoney(rows.commission);
  const salesCommission = sumMoney(rows.sales);
  const corrections = sumMoney(rows.corrections);
  const cardTips = sumMoney(rows.cardTips);
  const commissionSide = sumMoney([commission, salesCommission, corrections]);
  return {
    employeeId: rows.row.employeeId,
    employeeNumber: rows.row.employeeNumber,
    employeeNameAr: rows.row.employeeNameAr,
    employeeNameEn: rows.row.employeeNameEn,
    commission,
    salesCommission,
    corrections,
    cardTips,
    cashTips: sumMoney(rows.cashTips),
    netPayable: sumMoney([nonNegative(commissionSide), nonNegative(cardTips)]),
    partial: rows.row.partial,
  };
}

function append(rows: MutableEmployeeRows, row: CommissionStatementWorkbookRow): void {
  if (row.kind === 'COMMISSION') rows.commission.push(row.amount);
  if (row.kind === 'SALE') rows.sales.push(row.amount);
  if (row.kind === 'CORRECTION' || row.kind === 'CARRY_COMMISSION') {
    rows.corrections.push(row.amount);
  }
  if (
    row.kind === 'TIP_CARD' ||
    row.kind === 'CORRECTION_TIP_CARD' ||
    row.kind === 'CARRY_TIP_CARD'
  ) {
    rows.cardTips.push(row.amount);
  }
  if (row.kind === 'TIP_CASH' || row.kind === 'CORRECTION_TIP_CASH') {
    rows.cashTips.push(row.amount);
  }
}

/**
 * يجمّع الصفوف المجمّدة لكل موظفة من غير إعادة تسعير؛ الصافي بيتبع قاعدة CS-Q7 وCS-Q29:
 * جانب العمولة وجانب بقشيش الكارت ما بيتخصموش من بعض، والبقشيش كاش للعلم بس.
 *
 * @param rows الصفوف المجمّدة بعد ترشيح نطاق القارئ
 * @returns إجمالي واحد لكل موظفة، مرتب برقمها الوظيفي ثم معرّفها
 */
export function summarizeCommissionStatement(
  rows: readonly CommissionStatementWorkbookRow[],
): CommissionStatementEmployeeTotal[] {
  const employees = new Map<string, MutableEmployeeRows>();
  for (const row of rows) {
    const current = employees.get(row.employeeId) ?? {
      row,
      commission: [],
      sales: [],
      corrections: [],
      cardTips: [],
      cashTips: [],
    };
    append(current, row);
    employees.set(row.employeeId, current);
  }
  return [...employees.values()]
    .map(total)
    .sort(
      (left, right) =>
        left.employeeNumber - right.employeeNumber ||
        left.employeeId.localeCompare(right.employeeId),
    );
}
