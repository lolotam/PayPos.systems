import type { Tx } from '@pospay/db';

/** اسم فرع واحد كما يملكه التينانسي: الاسم العربي اختياري والإنجليزي مطلوب. */
export type CommissionBranchName = {
  readonly nameAr: string | null;
  readonly nameEn: string;
};

/**
 * قراءة أسماء الفروع من التينانسي، عشان موديول العمولات ما يقراش جدول الفروع.
 * البورت مربوط في composition root، فما بيكونش سهم استيراد بين الموديولات.
 */
export interface CommissionBranchNamesReader {
  /**
   * أسماء الفروع المطلوبة على معاملة المستدعي؛ الفرع اللي مش موجود بيفضل من غير اسم.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للفروع
   * @param businessId النشاط اللي الفروع مرتبطة بيه
   * @param branchIds معرّفات الفروع المطلوبة
   * @returns خريطة من معرّف الفرع إلى اسمه
   */
  names(
    tx: Tx,
    companyId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<ReadonlyMap<string, CommissionBranchName>>;
}
