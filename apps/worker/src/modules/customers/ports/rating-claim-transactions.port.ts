import type { DueRatingCursor, DueRatingRequest } from './rating-claim.repository.ts';

/** فتح معاملات المستأجر لجدولة المطالبة، لأن طبقة الـ jobs ما تصلش للداتابيز مباشرة. */
export interface RatingClaimTransactions<Transaction = unknown> {
  /**
   * يقرأ صفحة الطلبات المستحقة للشركة.
   *
   * @param companyId الشركة المالكة للطلبات
   * @param now لحظة الجولة
   * @param limit أقصى عدد طلبات في الصفحة
   * @param after آخر موضع في الصفحة اللي قبلها، أو null لأول صفحة
   * @returns الطلبات المستحقة غير المطالب بها
   */
  due(
    companyId: string,
    now: Date,
    limit: number,
    after: DueRatingCursor | null,
  ): Promise<readonly DueRatingRequest[]>;
  /**
   * يطالب بطلب واحد في معاملة مستقلة، ويمرّر معاملة المستأجر إلى الشغل.
   *
   * @param companyId الشركة المالكة للطلب
   * @param work الشغل على معاملة المستأجر
   * @returns اكتمال المعاملة
   */
  claim(companyId: string, work: (tx: Transaction) => Promise<void>): Promise<void>;
}
