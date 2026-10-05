import type { CleanupArtifact } from '../domain/artifacts.ts';

/** مصالحة bounded تستدعيها عملية التحقق وjobs الاحتفاظ الحالية. */
export interface ArtifactCleanup {
  /** يزيل الأجسام المؤقتة المستحقة دون المساس بالنسخة المنشورة.
   *
   * @param companyId الشركة الموثقة
   * @returns عدد المطالبات المنجزة
   */
  execute(companyId: string): Promise<number>;
}
/** ملكية الأجسام وحواجز نشرها وحذفها داخل معاملة المستأجر. */
export interface ArtifactRepository {
  /** يطالب بدفعة ويمنع نشر أي مرشح طالبه التنظيف.
   *
   * @param companyId الشركة
   * @param leaseId هوية المطالبة
   * @param at وقت الأهلية
   * @param until انتهاء المطالبة
   * @returns أجسام غير منشورة فقط
   */
  claim(
    companyId: string,
    leaseId: string,
    at: Date,
    until: Date,
  ): Promise<readonly CleanupArtifact[]>;
  /** يثبت الحذف والتدقيق الأول وموعد المصالحة التالية معاً.
   *
   * @param companyId الشركة
   * @param id هوية الجسم
   * @param leaseId المطالبة الحالية
   * @param at وقت الحذف
   * @param next الموعد التالي
   * @returns هل ما زالت المطالبة تخص العامل
   */
  complete(companyId: string, id: string, leaseId: string, at: Date, next: Date): Promise<boolean>;
  /** الفشل الخارجي يبقي الحذف مسجلاً ويتيح إعادة المحاولة فوراً.
   *
   * @param companyId الشركة
   * @param id هوية الجسم
   * @param leaseId المطالبة الحالية
   * @returns ينتهي بعد تحرير المطالبة إن ظلت مملوكة
   */
  release(companyId: string, id: string, leaseId: string): Promise<void>;
}
/** حد حذف idempotent؛ رسائل المزود لا تعبره. */
export interface ArtifactStorage {
  /** يحذف الجسم المحدد فقط، وغيابه نجاح.
   *
   * @param key المفتاح الداخلي المملوك
   * @returns ينتهي عند اكتمال الحذف
   */
  remove(key: string): Promise<void>;
}
