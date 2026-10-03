import type { DiscountSubject } from '../domain/effective-discount-limit.ts';

/** identity يملك العضوية وصفة صاحبها، والإعدادات لا تقرأ جداول هويته مباشرة. */
export interface DiscountSubjectReader {
  /**
   * بيعيد حد العضوية المتاحة في النشاط وصفة المالك لحل الحد بدون اختراع صلاحية.
   *
   * @param membershipId العضوية المطلوبة
   * @param businessId النشاط المطلوب
   */
  read(membershipId: string, businessId: string): Promise<DiscountSubject>;
}
