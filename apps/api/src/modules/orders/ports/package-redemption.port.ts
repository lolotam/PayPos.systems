/** زوج الاستحقاق والخدمة كما طلبه العميل، بالترتيب. */
export interface PackageRedemptionPair {
  entitlement_id: string;
  service_id: string;
}

/** لقطة استحقاق مقفلة بعد قفل المكوّن؛ هي حقائق الباقة وقت الزيارة. */
export interface PackageRedemptionSnapshot {
  entitlement_id: string;
  component_id: string;
  service_id: string;
  /** آخر يوم تُقبل فيه الزيارة؛ تاريخ بلا وقت. */
  expires_on: string;
  /** لحظة البيع؛ الباقة المستوردة بلا وقت بيع. */
  sold_at: Date | null;
}

/** جلسة باقة مرشّحة للاسترداد: أقل جلسة FREE في المكوّن. */
export interface PackageRedemptionSlot {
  id: string;
  ordinal: number;
  unit_value: bigint;
}

/** صف استرداد يُكتب مع سطر الزيارة في نفس المعاملة. */
export interface PackageRedemptionWrite {
  redemption_id: string;
  entitlement_id: string;
  component_id: string;
  slot_id: string;
  line_id: string;
  /** لحظة تسجيل الزيارة؛ هي لحظة الاسترداد (FR-026). */
  redeemed_at: Date;
  recorded_by: string;
  recorded_by_membership_id: string;
}

/** منفذ الاسترداد الذي تحتاجه الزيارة: القفل والقراءة والكتابة داخل معاملتها. */
export interface PackageRedemptionPort {
  /**
   * يقفل مكوّنات الاستحقاقات المطلوبة بالترتيب ويعيد لقطاتها، أو null إن خرج أحدها عن نطاق الزيارة.
   *
   * @param customer_id عميلة الزيارة؛ الاستحقاق لعميلة غيرها لا يُقفل ولا يُقرأ
   * @param pairs الاستحقاقات والخدمات المطلوبة بترتيب الطلب
   * @returns لقطات الاستحقاقات المقفلة بالترتيب نفسه، أو null عند أي عدم تطابق
   */
  lock(customer_id: string, pairs: readonly PackageRedemptionPair[]): Promise<readonly PackageRedemptionSnapshot[] | null>;
  /**
   * يقرأ أقل الجلسات الحرة في المكوّن بعد قفله، بالترتيب التصاعدي.
   *
   * @param component_id المكوّن المقفول
   * @param count عدد الجلسات المطلوبة
   * @returns الجلسات الحرة بالأرقام التصاعدية
   */
  freeSlots(component_id: string, count: number): Promise<readonly PackageRedemptionSlot[]>;
  /**
   * يقفل صف الجلسة المختارة ويعيدها إن كانت ما زالت حرة.
   *
   * @param slot_id صف الجلسة المختارة
   * @returns الجلسة المقفولة، أو null إن لم تعد حرة
   */
  lockSlot(slot_id: string): Promise<PackageRedemptionSlot | null>;
  /**
   * يكتب صفوف الاسترداد في نفس معاملة الزيارة.
   *
   * @param rows صفوف الاسترداد لكل سطر مسترد
   * @returns لا شيء
   */
  writeRedemptions(rows: readonly PackageRedemptionWrite[]): Promise<void>;
  /**
   * ينقل الجلسات من FREE إلى USED ويشير إلى صف الاسترداد الخاص بكل جلسة.
   *
   * @param rows الجلسة وصف الاسترداد الخاص بها
   * @returns لا شيء
   */
  markSlotsUsed(rows: readonly { slot_id: string; redemption_id: string }[]): Promise<void>;
}
