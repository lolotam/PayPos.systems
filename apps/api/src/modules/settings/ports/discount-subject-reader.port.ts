import type { DiscountSubject } from '../domain/effective-discount-limit.ts';

/** identity يملك العضوية وصفة صاحبها، والإعدادات لا تقرأ جداول هويته مباشرة. */
export interface DiscountSubjectReader {
  /**
   * بيثبت الشركة والعضوية بأقفال قراءة متوافقة قبل قفل الإعدادات وقراءة الحدين؛ العضوية الغائبة لا تظهر لاحقًا.
   *
   * @param membershipId العضوية المطلوبة في نفس المعاملة
   */
  lock(membershipId: string): Promise<boolean>;
  /**
   * بيعيد حد العضوية وصفة المالك بوقت حالي واحد بعد أقفال الشركة والعضوية والإعدادات؛ الانتظار لا يمد الأهلية.
   *
   * @param membershipId العضوية المطلوبة
   * @param businessId النشاط المطلوب
   */
  read(membershipId: string, businessId: string): Promise<DiscountSubject>;
}
