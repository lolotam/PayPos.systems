/**
 * الإشارة الحالية بعد قفل صف الإعدادات، قبل أي قفل على ملف.
 */
export interface LockedBusinessLogo {
  readonly officialNameAr: string | null;
  readonly officialNameEn: string | null;
  readonly previousFileId: string | null;
}

/**
 * قفل إعدادات النشاط ثم ملف الشعار بنفس ترتيب المستهلك، عشان الربط ما يعلقش مع بدء الحذف.
 */
export interface LogoFileReader {
  /**
   * إزالة من غير صف أو بشعار فاضي بتتقرأ من غير إنشاء. التغيير الحقيقي بيقفل صف الإعدادات قبل أي ملف.
   *
   * @param businessId النشاط
   * @param fileId الملف المطلوب، أو null عند الإزالة
   */
  lockSettings(businessId: string, fileId: string | null): Promise<LockedBusinessLogo>;
  /**
   * بيتحقق من ملكية الملف ونوعه قبل FOR UPDATE، وبعد القفل يعيد التحقق، عشان ملف مش بتاع النشاط ما يتقفلش.
   *
   * @param businessId النشاط في المسار
   * @param actorId المستخدم اللي بيربط
   * @param fileId الملف المختلف عن الشعار الحالي
   */
  lockCandidate(businessId: string, actorId: string, fileId: string): Promise<void>;
}
