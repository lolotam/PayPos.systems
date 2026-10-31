import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** حدود المعاملة: قراءة المفتاح وكتابته وسجل التدقيق كلهم جوه معاملة واحدة. */
export interface RatingSettingsScope {
  /** سجل التدقيق؛ تبديل المفتاح تغيير حساس فبيتسجل بنفس المعاملة (CLAUDE.md §8). */
  readonly audit: AuditTrail;
  /**
   * بيجيب القيمة المخزّنة للمفتاح؛ null معناها إن مفيش صف أو إن العمود نفسه NULL (مقفول).
   *
   * @param businessId النشاط المطلوب
   * @returns القيمة المخزّنة كما هي، أو null
   */
  current(businessId: string): Promise<boolean | null>;
  /**
   * بيكتب القيمة الجديدة على صف النشاط (إدراج أول مرة أو تعديل) ويزوّد رقم المراجعة.
   *
   * @param input النشاط والقيمة الجديدة ومن نفّذ التغيير ولحظة التغيير
   * @returns القيمة القديمة المخزّنة قبل الكتابة، أو null
   */
  save(input: {
    businessId: string;
    enabled: boolean;
    actorId: string;
    now: Date;
  }): Promise<{ before: boolean | null }>;
}

/** معاملة مفتاح طلبات التقييم: القراءة والكتابة والتدقيق جوه معاملة واحدة للشركة. */
export interface RatingSettingsTransactions {
  /**
   * ينفّذ العمل جوه معاملة الشركة، ومستخدم المعاملة هو اللي بيتسجّل في سجل التدقيق.
   *
   * @param companyId الشركة
   * @param userId    المستخدم اللي بيغيّر
   * @param work      العمل جوه المعاملة
   * @returns نتيجة العمل بعد نجاح المعاملة
   */
  run<T>(
    companyId: string,
    userId: string,
    work: (scope: RatingSettingsScope) => Promise<T>,
  ): Promise<T>;
}
