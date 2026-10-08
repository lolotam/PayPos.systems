import type { PackageService, PackageTypeRecord } from '../domain/package-type.ts';

/** معاملة نوع الباقة تضم المكونات والتدقيق كي لا يظهر تعريف جزئي. */
export interface PackageTypeScope {
  /**
   * يدرج النوع ومكوناته بالترتيب في نفس المعاملة.
   *
   * @param record التعريف المتحقق
   * @returns اكتمال الإدخال
   */
  insert(record: PackageTypeRecord): Promise<void>;
  /**
   * يحمل نوع النشاط بقفل تحديث، أو غيابه دون كشف نشاط آخر.
   *
   * @param businessId النشاط المتحقق
   * @param packageTypeId النوع المطلوب
   * @returns السجل المقفول أو غيابه
   */
  load(businessId: string, packageTypeId: string): Promise<PackageTypeRecord | null>;
  /**
   * يقرأ خدمات نفس النشاط دفعة واحدة للتحقق والعرض، بما فيها المجانية.
   *
   * @param businessId النشاط المالك
   * @param serviceIds معرفات الخدمات المطلوبة
   * @returns الخدمات المتاحة في هذا النشاط فقط
   */
  services(businessId: string, serviceIds: readonly string[]): Promise<PackageService[]>;
  /**
   * يستبدل التعريف والمكونات بعد التحقق من النسخة المقفولة.
   *
   * @param before النسخة الحالية
   * @param after التعريف البديل
   * @returns اكتمال الحفظ الذري
   */
  save(before: PackageTypeRecord, after: PackageTypeRecord): Promise<void>;
  /**
   * يسجل قبل وبعد مع المكونات دون أي أسعار بيع أو بيانات عملاء.
   *
   * @param before التعريف السابق أو غيابه عند الإنشاء
   * @param after التعريف المحفوظ
   * @returns اكتمال التدقيق
   */
  audit(before: PackageTypeRecord | null, after: PackageTypeRecord): Promise<void>;
}
/** هوية بشرية متحققة من الحارس قبل معاملة نوع الباقة. */
export interface PackageTypeActor {
  readonly companyId: string;
  readonly userId: string;
}
/** حد الحفظ الذري لنوع الباقة في شركة واحدة. */
export interface PackageTypeTransactions {
  /**
   * ينفذ الحفظ والتدقيق معاً ويرجع النتيجة بعد نجاح الالتزام.
   *
   * @param actor هوية الفاعل وشركته
   * @param work خطوات الحفظ على المعاملة
   * @returns النتيجة بعد الالتزام
   */
  run<T>(actor: PackageTypeActor, work: (scope: PackageTypeScope) => Promise<T>): Promise<T>;
}
