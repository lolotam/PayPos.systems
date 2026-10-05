import type { RetentionKind } from '../domain/retention.ts';
/** هوية الجسم المؤقت المملوك للشركة؛ لا تعبر إلى Redis. */
export interface RetentionFile {
  id: string;
  stagingKey: string;
}
/** حد الاحتفاظ المعاملاتي؛ IO التخزين خارج هذا الحد. */
export interface RetentionRepository {
  /** يطالب بدفعة محدودة مع قفل يمنع تأكيد الملف بعد بدء حذفه.
   *
   * @param companyId الشركة
   * @param kind نوع الاحتفاظ
   * @param leaseId هوية المحاولة
   * @param at وقت المطالبة
   * @param cutoff وقت أهلية الحذف
   * @param until انتهاء المطالبة
   * @returns هويات وأجسام الدفعة المحدودة
   */
  claim(
    companyId: string,
    kind: RetentionKind,
    leaseId: string,
    at: Date,
    cutoff: Date,
    until: Date,
  ): Promise<readonly RetentionFile[]>;
  /** يثبت الحذف مرة واحدة مع أثر تدقيق للنظام، ولا يمسح تاريخ الوصول.
   *
   * @param companyId الشركة
   * @param fileId هوية الملف
   * @param kind سبب الحذف
   * @param leaseId المطالبة الحالية
   * @param at وقت الحذف
   * @returns هل ثبتت هذه المحاولة الحذف
   */
  complete(
    companyId: string,
    fileId: string,
    kind: RetentionKind,
    leaseId: string,
    at: Date,
  ): Promise<boolean>;
}
/** حذف idempotent لجسم التخزين الخاص. */
export interface RetentionStorage {
  /** نجاح حذف جسم غير موجود أيضاً؛ خطأ المزود يبقي المطالبة قابلة لإعادة المحاولة.
   *
   * @param key المفتاح الداخلي
   * @returns ينتهي عند حذف الجسم أو التأكد من غيابه
   */
  remove(key: string): Promise<void>;
}
