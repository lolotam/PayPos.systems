/** اسم الفرع وأسماء النشاط ومنطقته الزمنية الفعّالة كما يملكها التينانسي. */
export interface BranchPlace {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly timeZone: string;
  readonly businessNameAr: string | null;
  readonly businessNameEn: string;
}

/**
 * قراءة مكان الوردية من التينانسي، حتى لا يضم staff جداول الفروع والأنشطة.
 * المنطقة الفعّالة هي منطقة الفرع إن وُجدت وإلا منطقة النشاط.
 */
export interface BranchPlaceReader<Transaction> {
  /**
   * اسم الفرع وأسماء النشاط ومنطقته الزمنية الفعّالة؛ القارئ ده بيخدم قراءتين: رسالة عدم
   * الحضور بتقراها بعد قفل State، وبيان الحضور بيقراه في معاملة قراءة عادية من غير قفل.
   *
   * @param tx معاملة الشركة: بعد قفل State في رسالة عدم الحضور، ومعاملة قراءة عادية في البيان
   * @param companyId الشركة المجدولة
   * @param businessId نشاط الوردية
   * @param branchId فرع الوردية
   * @returns المكان أو null إن لم يوجد الفرع
   */
  forBranch(
    tx: Transaction,
    companyId: string,
    businessId: string,
    branchId: string,
  ): Promise<BranchPlace | null>;
}
