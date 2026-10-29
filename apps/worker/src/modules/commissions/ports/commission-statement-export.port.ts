import type { Money } from '@pospay/domain';

export type CommissionStatementExportLanguage = 'ar' | 'en';
export type CommissionStatementExportScope = 'BUSINESS' | 'BRANCHES';
export type CommissionStatementFrozenKind =
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

export interface CommissionStatementExportRequest {
  readonly statementId: string;
  readonly businessId: string;
  readonly period: string;
  readonly statementStatus: 'APPROVED' | 'PAID';
  readonly language: CommissionStatementExportLanguage;
  readonly scope: CommissionStatementExportScope;
  readonly branchIds: readonly string[] | null;
  readonly employeeIds: readonly string[] | null;
}

export interface CommissionStatementFrozenRow {
  readonly employeeId: string;
  readonly employeeNumber: number;
  readonly employeeNameAr: string | null;
  readonly employeeNameEn: string;
  readonly sourceRef: string;
  readonly kind: CommissionStatementFrozenKind;
  readonly amount: Money;
  readonly previousAmount: Money | null;
  readonly newAmount: Money | null;
  readonly sourcePeriod: string | null;
  readonly sourceBranchId: string | null;
  readonly attachedBranchIds: readonly string[];
  /** true لما أي صف من شهر الموظفة برّه فروع الطلب؛ الأرقام الظاهرة يبقى مجموع جزئي. */
  readonly partial: boolean;
  readonly businessDate: string | null;
  readonly serviceNameAr: string | null;
  readonly serviceNameEn: string | null;
  readonly customerName: string | null;
}

export interface CommissionStatementPaidCash {
  readonly employeeId: string;
  readonly amount: Money;
}

export interface CommissionStatementExportData {
  readonly request: CommissionStatementExportRequest;
  readonly rows: readonly CommissionStatementFrozenRow[];
  readonly paidCash: readonly CommissionStatementPaidCash[] | null;
}

/** قارئ طلب التصدير وصفوفه المجمّدة؛ بيحتاجه مصدر الملف عشان يبني نفس الكشف من غير بيانات حيّة. */
export interface CommissionStatementExportReader {
  /**
   * بيرجّع الطلب والصفوف المسموح بها فقط، أو null لما الـ render id مش موجود في المستأجر.
   *
   * @param companyId المستأجر من حمولة الوظيفة
   * @param renderId معرّف الرندر المحفوظ في طلب التصدير
   * @param signal إلغاء مهلة الرندر
   * @returns الطلب وصفوفه المجمّدة المفلترة أو null
   */
  read(
    companyId: string,
    renderId: string,
    signal?: AbortSignal,
  ): Promise<CommissionStatementExportData | null>;
}
