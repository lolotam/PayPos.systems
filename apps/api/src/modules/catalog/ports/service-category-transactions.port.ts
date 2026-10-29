import type { ServiceCategoryBranchSettingRecord } from '../domain/service-category-branch.ts';
import type { ServiceCategoryRecord } from '../domain/service-category.ts';

/** معاملة تصنيف الخدمة تضم الكتابة والتدقيق في معاملة واحدة. */
export interface ServiceCategoryScope {
  /**
   * يدرج التصنيف الجديد في معاملة النشاط.
   *
   * @param record التصنيف المتحقق منه
   * @returns اكتمال الإدخال
   */
  insert(record: ServiceCategoryRecord): Promise<void>;
  /**
   * يحمل التصنيف بقفل تحديث، وهو ترتيب القفل الذي تكتبه كل عملية تعديل على تصنيف.
   *
   * @param businessId النشاط المالك
   * @param categoryId التصنيف المطلوب
   * @returns السجل المقفول أو غيابه
   */
  load(businessId: string, categoryId: string): Promise<ServiceCategoryRecord | null>;
  /**
   * يحمل التصنيف بقفل مشاركة قبل تغيير حالته في فرع، بترتيب القفل الموحّد مع كتابات الخدمات.
   *
   * @param businessId النشاط المالك
   * @param categoryId التصنيف المطلوب
   * @returns السجل المقفول للمشاركة أو غيابه
   */
  loadForShare(businessId: string, categoryId: string): Promise<ServiceCategoryRecord | null>;
  /**
   * يحمل إعداد الفرع والتصنيف بقفل تحديث بعد قفل التصنيف، لفحص النسخة والكتابة المتسقة.
   *
   * @param businessId نشاط الفرع والتصنيف
   * @param branchId الفرع صاحب الإعداد
   * @param categoryId التصنيف صاحب الإعداد
   * @returns صف الإعداد المقفول أو غيابه
   */
  loadBranchSetting(
    businessId: string,
    branchId: string,
    categoryId: string,
  ): Promise<ServiceCategoryBranchSettingRecord | null>;
  /**
   * يقرأ نشاط الفرع من قاعدة البيانات، لأن العميل لا يحدد نشاط الفرع.
   *
   * @param branchId الفرع المطلوب
   * @returns نشاط الفرع أو غيابه
   */
  branchBusiness(branchId: string): Promise<string | null>;
  /**
   * يحفظ التعديل بعد التحقق من النسخة المقفولة، ويرفض الكتابة لو تغيّرت النسخة أثناء ذلك.
   *
   * @param before النسخة المقفولة
   * @param after السجل البديل
   * @returns اكتمال الحفظ الذري
   */
  save(before: ServiceCategoryRecord, after: ServiceCategoryRecord): Promise<void>;
  /**
   * يسجل قبل وبعد التصنيف في التدقيق، بلا أي بيانات عميل أو خدمة.
   *
   * @param before التصنيف السابق أو غيابه عند الإنشاء
   * @param after التصنيف المحفوظ
   * @returns اكتمال التدقيق
   */
  audit(before: ServiceCategoryRecord | null, after: ServiceCategoryRecord): Promise<void>;
  /**
   * يدرج أول إعداد لتصنيف في فرع؛ تعارض المفتاح الفريد يتحول إلى نفس رفض النسخة القديمة.
   *
   * @param record إعداد النسخة الأولى
   * @returns اكتمال الإدخال
   */
  insertBranchSetting(record: ServiceCategoryBranchSettingRecord): Promise<void>;
  /**
   * يحفظ إعداد الفرع على نسخته المقفولة فقط، فلا تكتب حالة قديمة فوق حالة أحدث.
   *
   * @param before الصف المقفول السابق
   * @param after الحالة والنسخة التاليتان
   * @returns اكتمال الحفظ الذري
   */
  saveBranchSetting(
    before: ServiceCategoryBranchSettingRecord,
    after: ServiceCategoryBranchSettingRecord,
  ): Promise<void>;
  /**
   * يسجل قبل وبعد إعداد الفرع في التدقيق داخل معاملة الحالة نفسها.
   *
   * @param before الإعداد السابق أو غيابه عند أول كتابة
   * @param after الإعداد المحفوظ
   * @returns اكتمال التدقيق
   */
  auditBranchSetting(
    before: ServiceCategoryBranchSettingRecord | null,
    after: ServiceCategoryBranchSettingRecord,
  ): Promise<void>;
}

/** هوية بشرية متحققة من الحارس قبل معاملة التصنيف. */
export interface ServiceCategoryActor {
  readonly companyId: string;
  readonly userId: string;
}

/** حد الحفظ الذري لتصنيفات شركة واحدة. */
export interface ServiceCategoryTransactions {
  /**
   * ينفذ الحفظ والتدقيق معاً ويرجع النتيجة بعد نجاح الالتزام.
   *
   * @param actor هوية الفاعل وشركته
   * @param work خطوات الحفظ على المعاملة
   * @returns النتيجة بعد الالتزام
   */
  run<T>(actor: ServiceCategoryActor, work: (scope: ServiceCategoryScope) => Promise<T>): Promise<T>;
}
