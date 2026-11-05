import type { DueRatingRequest } from './rating-claim.repository.ts';

/** معاملات المستأجر لخطوات المجدول: قراءة حدود الجولة، وقراءة طلب واحد بمعاملته. */
export interface RatingClaimTransactions<Transaction = unknown> {
  /**
   * يقرأ الحد الأعلى للجولة في معاملة مستقلة، عشان ما ياخدش اتصال معاملة تاني معاه.
   *
   * @param companyId الشركة المالكة للطلبات
   * @returns أكبر معرّف ظاهر للشركة، أو null لما الشركة لسه فاضية
   */
  upperId(companyId: string): Promise<string | null>;
  /**
   * يقرأ صفحة معرّفات في معاملة مستقلة، عشان تخلص قبل أي مطالبة.
   *
   * @param companyId الشركة المالكة للطلبات
   * @param after آخر معرّف في الصفحة اللي قبلها، أو null لأول صفحة
   * @param through الحد الأعلى المقطوع في بداية الجولة
   * @param limit أقصى عدد معرّفات في الصفحة
   * @returns معرّفات الصفحة بالترتيب التصاعدي
   */
  pageIds(
    companyId: string,
    after: string | null,
    through: string,
    limit: number,
  ): Promise<readonly string[]>;
  /**
   * يفتح معاملة واحدة للطلب الواحد: بيقرأ الصف، ويمرّره للشغل، وبيستنى الـ commit
   * قبل ما يرجع.
   *
   * النتيجة المرجعية (إن الـ commit نجح ولا فشل) ماتتحدّدش غير بعد ما الداتابيز
   * تقفل المعاملة، فما ينفعش يتصرف حد على نتيجة لسه مفتوحة.
   *
   * @param companyId الشركة المالكة للطلب
   * @param requestId الطلب المطلوب
   * @param work الشغل على معاملة المستأجر مع الصف المقروء
   * @returns نتيجة الشغل بعد الـ commit
   */
  withRequest<T>(
    companyId: string,
    requestId: string,
    work: (tx: Transaction, request: DueRatingRequest | null) => Promise<T>,
  ): Promise<T>;
}
