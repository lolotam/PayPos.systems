import type { PackageTypeSellingState } from '../domain/package-type-selling.ts';
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
   * يحفظ حالة البيع والنسخة ووقت التحديث فقط على الصف المقفول، دون لمس مكونات التعريف.
   *
   * @param before السجل المقفول الذي تحمل نسخته شرط الكتابة
   * @param after حالة البيع الجديدة ونسختها
   * @param at وقت القرار الذي يُكتب في updated_at
   * @returns اكتمال تحديث حالة البيع
   */
  saveSelling(before: PackageTypeRecord, after: PackageTypeSellingState, at: Date): Promise<void>;
  /**
   * يسجل انتقال البيع بلقطة قبل وبعد تقتصر على وقت الإيقاف والنسخة.
   *
   * @param before السجل قبل الانتقال
   * @param after حالة البيع المحفوظة التي تحدد selling_stopped أو selling_resumed
   * @returns اكتمال تسجيل التدقيق
   */
  auditSelling(before: PackageTypeRecord, after: PackageTypeSellingState): Promise<void>;
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
