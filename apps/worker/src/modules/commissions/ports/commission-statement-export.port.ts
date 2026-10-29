import type { Money } from '@pospay/domain';

import type {
  CommissionStatementEmployeeTotal,
  CommissionStatementRowKind,
} from '../domain/commission-statement-totals.ts';

export type CommissionStatementExportLanguage = 'ar' | 'en';
export type CommissionStatementExportScope = 'BUSINESS' | 'BRANCHES';
export type CommissionStatementFrozenKind = CommissionStatementRowKind;

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
  /** الفرع اللي اتنفذت فيه الشغلة، واسمه المتجمّد في صف الكشف وقت الاعتماد (CS-Q35)؛ تغيير اسم الفرع بعد كده ما يغيّروش، وهو للعرض بس ومش مفتاح ترشيح (CM-55f). */
  readonly sourceBranchNameAr: string | null;
  readonly sourceBranchNameEn: string | null;
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

/** الطلب والصفوف المجمّدة كما اتقراها من الداتابيز، من غير أي إجماليات محسوبة. */
export interface CommissionStatementExportReaderData {
  readonly request: CommissionStatementExportRequest;
  readonly rows: readonly CommissionStatementFrozenRow[];
  readonly paidCash: readonly CommissionStatementPaidCash[] | null;
}

/** الطلب والصفوف وإجماليات كل موظفة؛ الإجماليات محسوبة في domain/مش في الملف. */
export interface CommissionStatementExportData extends CommissionStatementExportReaderData {
  readonly employees: readonly CommissionStatementEmployeeTotal[];
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
  ): Promise<CommissionStatementExportReaderData | null>;
}
