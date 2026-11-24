import type { StatementStatus } from '@pospay/db';

/** هوية صاحب طلب الصرف: الشركة والنشاط والشهر، لأن الصرف يقيَّد بصلاحية المستخدم على نشاط الكشف. */
export interface MarkStatementPaidActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly period: string;
}

/** طلب تسجيل صرف بهوية الفاعل والجسم ومفتاح إعادة الإرسال، عشان الإعادة تتفرّق عن مفتاح متكرر. */
export interface MarkStatementPaidCommand extends MarkStatementPaidActor {
  readonly input: {
    readonly paid_method: 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH';
    readonly paid_on: string;
    readonly paid_note?: string | undefined;
  };
  readonly key: string;
  readonly fingerprint: string;
}

/** الشهر المقفول بحالته وقت الصرف وتاريخ اعتماده؛ الاعتماد موجود دايماً لما الحالة APPROVED. */
export interface LockedStatementForPayment {
  readonly statementId: string;
  readonly status: StatementStatus;
  readonly approvedAt: Date | null;
}

/** الكتابة الميكانيكية لمعاملة الصرف: أعمدة الدفع وصفوف الدفع اللي الـ domain حسبها من قبل. */
export interface StatementPaymentWrite {
  readonly statementId: string;
  readonly period: string;
  readonly paidBy: string;
  readonly paidOn: string;
  readonly paidMethod: 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH';
  readonly paidNote: string | null;
  readonly payments: readonly {
    readonly employeeId: string;
    readonly exactPayable: string;
    readonly paidAmount: string;
  }[];
}

/** خطوات الكتابة التي تحتاجها حالة استخدام صرف الكشف داخل معاملة واحدة. */
export interface MarkStatementPaidScope {
  /**
   * بيقفل صف شهر الكشف ويرجّع حالته وتاريخ اعتماده بعد القفل، وبيتصرف كأن الشهر موجود.
   *
   * @returns الشهر المقفول بمعرفه وحالته وتاريخ اعتماده
   */
  lockStatement(): Promise<LockedStatementForPayment>;
  /**
   * بيرجّع توقيت النشاط على معاملة الصرف لتحديد النهارده وتاريخ الاعتماد المحليين.
   *
   * @returns التوقيت وتاريخ إنشاء النشاط، أو null عند غياب النشاط
   */
  calendar(): Promise<{ readonly timeZone: string; readonly createdAt: Date } | null>;
  /**
   * بيعيد قرار pay:commissions:business وميزة العمولات بعد أقفال الكشف.
   *
   * @returns FORBIDDEN أو FEATURE_DISABLED عند الرفض، أو null عند السماح
   */
  recheckAccess(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /**
   * بيقرا البنود المجمّدة للكشف تحت القفل، لأن صوافي الصرف بتتحسب منهم في نفس المعاملة.
   *
   * @param statementId كشف الشهر المقفول
   * @returns هوية الموظفة ونوع البند ومبلغه لكل بند مجمّد
   */
  frozenLines(statementId: string): Promise<
    readonly { readonly employeeId: string; readonly kind: string; readonly amount: string }[]
  >;
  /**
   * بيكتب أعمدة الدفع على الكشف وصف دفع لكل موظفة مجمّدة، ويرجّع وقت التسجيل اللي الرد بيصدّقه.
   *
   * @param record أعمدة الدفع وصفوف الدفع المحسوبة من الـ domain
   * @returns وقت التسجيل بصيغة ISO على توقيت UTC
   */
  markPaid(record: StatementPaymentWrite): Promise<{ readonly paidAt: string }>;
  /**
   * بيكتب تدقيق الصرف بتاريخيه في نفس المعاملة، بلا بيانات موظفة حساسة.
   *
   * @param record نفس الكتابة مع وقت التسجيل ومجموع المصروف
   * @returns اكتمال التدقيق
   */
  audit(
    record: StatementPaymentWrite & {
      readonly paidAt: string;
      readonly paidTotal: string;
    },
  ): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال لتسجيل صرف كشف الشهر. */
export interface CommissionStatementPayTransactions {
  /**
   * ينفذ فحص الصلاحية وقفل الشهر والكتابة والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
   * لو انتهى انتظار المطالبة بخطأ الانشغال فالمعاملة بتتلغي، والصلاحية بتتقرى مرة كمان قبل الرد.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns رد تسجيل الصرف أو جسم الرد المخزن
   */
  run<T>(
    command: MarkStatementPaidCommand,
    work: (scope: MarkStatementPaidScope) => Promise<T>,
  ): Promise<T>;
}
