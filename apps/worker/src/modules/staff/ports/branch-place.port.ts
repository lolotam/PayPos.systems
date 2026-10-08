import type { Tx } from '@pospay/db';

/** اسم الفرع باللغتين والمنطقة الزمنية الفعّالة كما يملكها التينانسي. */
export interface BranchPlace {
  readonly nameAr: string | null;
  readonly nameEn: string;
  readonly timeZone: string;
}

/**
 * قراءة مكان الوردية من التينانسي، حتى لا يضم staff جداول الفروع والأنشطة.
 * المنطقة الفعّالة هي منطقة الفرع إن وُجدت وإلا منطقة النشاط.
 */
export interface BranchPlaceReader {
  /**
   * اسم الفرع باللغتين ومنطقته الزمنية الفعّالة لرسالة عدم الحضور.
   *
   * @param tx معاملة الشركة بعد قفل State
   * @param companyId الشركة المجدولة
   * @param businessId نشاط الوردية
   * @param branchId فرع الوردية
   * @returns المكان أو null إن لم يوجد الفرع
   */
  forBranch(
    tx: Tx,
    companyId: string,
    businessId: string,
    branchId: string,
  ): Promise<BranchPlace | null>;
}
