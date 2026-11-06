import type { PackageCommitPreview, packageCommitRows } from '../domain/package-import-commit.ts';
/** صف موثق بترتيبه الكثيف في المصدر. */
export type PackageCommitRow = ReturnType<typeof packageCommitRows>[number];
/** نطاق عمليات تشترك جميعها في معاملة المستأجر الواحدة. */
export interface PackageCommitScope {
  readonly preview: PackageCommitPreview | null;
  /** يقفل أسماء الخدمات المرجعية بترتيب الهوية ويتحقق من اكتمالها.
   *
   * @param rows الصفوف المطلوب قفل خدماتها
   */
  lockServices(rows: readonly PackageCommitRow[]): Promise<void>;
  /** يكتب الأب الفائز ثم كل المكونات قبل الجلسات؛ false لتعارض المرجع فقط.
   *
   * @param row صف الباقة الموثق
   * @param at لحظة التثبيت المحقونة
   */
  insert(row: PackageCommitRow, at: string): Promise<boolean>;
  /** يثبت النتيجة والتدقيق والحدث دون تعديل الإثبات.
   *
   * @param createdCount عدد الباقات المنشأة
   * @param at لحظة التثبيت المحقونة
   */
  complete(createdCount: number, at: string): Promise<void>;
}
/** منفذ معاملة التثبيت وفشل الطلب بعد rollback. */
export interface PackageCommitTransactions {
  /** يقفل المعاينة وينفذ الكتابات حتى اكتمال COMMIT.
   *
   * @param companyId هوية المستأجر
   * @param previewId هوية المعاينة
   * @param work عمليات التثبيت في المعاملة الواحدة
   */
  run(
    companyId: string,
    previewId: string,
    work: (scope: PackageCommitScope) => Promise<void>,
  ): Promise<void>;
  /** يفشل طلب الباقات المعلق فقط دون المساس بالكيانات الأخرى.
   *
   * @param companyId هوية المستأجر
   * @param previewId هوية المعاينة
   * @param code رمز الرفض الآمن
   */
  fail(companyId: string, previewId: string, code: string): Promise<void>;
}
/** ساعة محقونة لتوحيد لحظة التثبيت. */
export interface PackageCommitClock {
  /** يعيد وقت التثبيت من الساعة المحقونة. */
  now(): Date;
}
