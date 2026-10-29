import type { Money } from '@pospay/domain';

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
  /** اسم فرع التنفيذ وقت التجميد؛ بيتعرض في ورقة التفاصيل وما بيشتغلش كفلتر (CM-55f). */
  readonly sourceBranchNameAr: string | null;
  readonly sourceBranchNameEn: string | null;
  readonly partial: boolean;
}

/** إجمالي موظفة واحدة جاهز للعرض؛ الحساب بيحصل قبل الملف في domain/مش هنا. */
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
