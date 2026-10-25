import type { Tx } from '@pospay/db';

/** مفتاح الطلب الوحيد للعميل في النشاط ويوم الفرع. */
export interface RatingRequestKey {
  readonly companyId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly businessDate: string;
}

/** حقول الصف اللازمة لقرار الجدولة دون كشف بيانات الروابط أو الإرسال. */
export interface RatingRequestRow {
  readonly id: string;
  readonly status: 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
  readonly cancelReason: string | null;
  readonly branchId: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
}

/** تخزين طلب التقييم على معاملة المستهلك نفسها. */
export interface RatingRequestRepository {
  /**
   * يقفل صف يوم الطلب ويرجع حالته قبل إعادة الحساب.
   *
   * @param tx معاملة المستأجر
   * @param key مفتاح العميل والنشاط واليوم
   * @returns الصف المقفل أو null عند غيابه
   */
  lock(tx: Tx, key: RatingRequestKey): Promise<RatingRequestRow | null>;
  /**
   * ينشئ صفاً مجدولاً إن لم يوجد دون استبدال صف أنشأه تسليم متزامن.
   *
   * @param tx معاملة المستأجر
   * @param key مفتاح العميل والنشاط واليوم
   * @param row المعرف والفرع والمواعيد الابتدائية
   * @returns اكتمال محاولة الإدخال
   */
  insertIfAbsent(
    tx: Tx,
    key: RatingRequestKey,
    row: { id: string; branchId: string; dueAt: Date; sendDeadline: Date | null },
  ): Promise<void>;
  /**
   * يعيد الصف إلى SCHEDULED بأحدث فرع ومواعيد ويمسح سبب الإلغاء السابق.
   *
   * @param tx معاملة المستأجر
   * @param key مفتاح العميل والنشاط واليوم
   * @param row الفرع والمواعيد المعاد حسابها
   * @param at لحظة التحديث
   * @returns اكتمال التحديث
   */
  schedule(
    tx: Tx,
    key: RatingRequestKey,
    row: { branchId: string; dueAt: Date; sendDeadline: Date | null },
    at: Date,
  ): Promise<void>;
  /**
   * يلغي الصف بسبب غياب البنود النشطة أو انتهاء موعد الإرسال.
   *
   * @param tx معاملة المستأجر
   * @param key مفتاح العميل والنشاط واليوم
   * @param reason سبب الإلغاء المسموح للجدولة
   * @param at لحظة التحديث
   * @returns اكتمال التحديث
   */
  cancel(
    tx: Tx,
    key: RatingRequestKey,
    reason: 'NO_ACTIVE_LINE' | 'PAST_DEADLINE',
    at: Date,
  ): Promise<void>;
}
