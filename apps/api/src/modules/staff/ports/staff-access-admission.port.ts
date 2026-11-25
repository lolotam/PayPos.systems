/** حصة منحة محجوزة في العملية: شركة واحدة وقت واحد. */
export interface StaffAccessGrantSlot {
  /** الشركة اللي اتحجزت لها الحصة. */
  readonly companyId: string;
}

/**
 * بوابة دخول المنح: بتمنع منحين متزامنين لنفس الشركة وبتحدّ عدد المنح الجارية في العملية كلها.
 * البوابة بتقرر قبل أي معاملة شركة أو قبل أي اتصال بـ auth، فالرفض بيبان فورًا من غير شغل مكرر.
 */
export interface StaffAccessGrantAdmission {
  /**
   * يحاول يحجز حصة منحة للشركة قبل فتح أي معاملة.
   *
   * @param companyId الشركة اللي طلبت المنح
   * @returns الحصة المحجوزة، أو null لو المنح مرفوض
   */
  admit(companyId: string): StaffAccessGrantSlot | null;
  /**
   * يحرر الحصة بعد انتهاء المنح؛ التحرير المكرر مالهوش أثر.
   *
   * @param slot الحصة اللي اتحررت
   */
  release(slot: StaffAccessGrantSlot): void;
}

/**
 * بوابة مفتوحة: بتسمح بكل المنح وبلا حد — للاستخدامات اللي بتقيس سلوك تاني غير التقييد.
 *
 * @returns بوابة بتقبل كل طلبات المنح
 */
export const unlimitedStaffAccessGrantAdmission: StaffAccessGrantAdmission = {
  admit: (companyId: string): StaffAccessGrantSlot => ({ companyId }),
  release: (): void => undefined,
};
