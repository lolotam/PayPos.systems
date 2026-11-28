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
  readonly claimedAt?: Date | null;
}

/** صف طلب اليوم السابق اللازم للتحقق في طبقة النطاق من تغطية زيارة ليلية قديمة بعد تعديل المواعيد. */
export interface PreviousDayRatingRequestRow {
  readonly businessDate: string;
  readonly branchId: string;
  readonly dueAt: Date;
  readonly sendDeadline: Date | null;
  readonly claimedAt: Date | null;
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
   * @param row.id معرف طلب التقييم الجديد
   * @param row.branchId فرع أحدث زيارة
   * @param row.dueAt موعد استحقاق الطلب
   * @param row.sendDeadline الموعد النهائي للإرسال أو null
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
   * @param row.branchId فرع أحدث زيارة
   * @param row.dueAt موعد الاستحقاق المعاد حسابه
   * @param row.sendDeadline الموعد النهائي المعاد حسابه أو null
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
  /**
   * يقرأ طلب التقييم لليوم المدني السابق (إن وُجد بمهلة إرسال) للتحقق في طبقة النطاق من تغطية الزيارات الليلية القديمة.
   *
   * @param tx معاملة المستأجر
   * @param key هوية الشركة والنشاط والعميل والتاريخ المدني السابق
   * @param key.companyId معرف الشركة
   * @param key.businessId معرف النشاط
   * @param key.customerId معرف العميل
   * @param key.previousDate التاريخ المدني السابق بصيغة YYYY-MM-DD
   * @returns صف الطلب السابق أو null عند عدم وجوده
   */
  findPreviousDayRequest?(
    tx: Tx,
    key: {
      readonly companyId: string;
      readonly businessId: string;
      readonly customerId: string;
      readonly previousDate: string;
    },
  ): Promise<PreviousDayRatingRequestRow | null>;
}
