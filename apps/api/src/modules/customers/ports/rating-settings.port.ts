import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';

/** طلب حفظ مفتاح طلبات التقييم: النشاط والقيمة الجديدة ومن نفّذ التغيير ولحظة التغيير. */
export interface SaveRatingSettingsInput {
  /** النشاط صاحب المفتاح. */
  readonly businessId: string;
  /** القيمة الجديدة: true مفتوح، false مقفول. */
  readonly enabled: boolean;
  /** المستخدم اللي بدّل المفتاح؛ بيتكتب في updated_by. */
  readonly actorId: string;
  /** لحظة التغيير من الساعة المحقونة؛ بتتخزّن في updated_at. */
  readonly now: Date;
}

/** حدود المعاملة: كتابة المفتاح وسجل التدقيق جوه معاملة واحدة. */
export interface RatingSettingsScope {
  /** سجل التدقيق؛ تبديل المفتاح تغيير حساس فبيتسجل بنفس المعاملة (CLAUDE.md §8). */
  readonly audit: AuditTrail;
  /**
   * بيكتب القيمة الجديدة على صف النشاط (إدراج أول مرة أو تعديل) ويزوّد رقم المراجعة.
   *
   * @param input النشاط والقيمة الجديدة ومن نفّذ التغيير ولحظة التغيير
   * @returns القيمة القديمة المخزّنة قبل الكتابة، أو null
   */
  save(input: SaveRatingSettingsInput): Promise<{ before: boolean | null }>;
}

/** معاملة مفتاح طلبات التقييم: الكتابة والتدقيق جوه معاملة واحدة للشركة. */
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
