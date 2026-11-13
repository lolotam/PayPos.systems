import type { ServiceCategoryBranchSettingRecord } from '../domain/service-category-branch.ts';
import type {
  ServiceCategoryClosingPlan,
  ServiceRecordChange,
} from '../domain/service-category-closing.ts';
import type { ServiceCategoryRecord } from '../domain/service-category.ts';
import type { ServiceRecord } from '../domain/service.ts';

/** مدخلات تدقيق التصنيف عند الإغلاق أو الفتح: صف التدقيق الخاص بالتصنيف وحده، أما تدقيق الخدمات فتكتبه جملة الكاسكاد مع تحديثها. */
export interface ServiceCategoryClosingAudit extends ServiceCategoryClosingPlan {
  readonly action: 'closed' | 'reopened';
}

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
   * يقرأ نشاط الفرع ويقفل صفه ضد الحذف أو تغيير المفاتيح حتى نهاية المعاملة، لأن العميل لا يحدد نشاط الفرع.
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
   * يقفل خدمات التصنيف المفتوحة تصاعدياً بقفل لا يمنع مفاتيح FK، لتخطيط العدد والكتابة المتسقة.
   *
   * @param businessId النشاط المالك
   * @param categoryId التصنيف الذي سيُغلق
   * @returns سجلات الخدمات المفتوحة كاملة للتخطيط والتدقيق
   */
  lockOpenServices(businessId: string, categoryId: string): Promise<ServiceRecord[]>;
  /**
   * يقفل الخدمات المعلّمة بهذا التصنيف تصاعدياً، لاسترجاع ما أغلقه التصنيف وحده عند فتحه.
   *
   * @param businessId النشاط المالك
   * @param categoryId التصنيف الذي سيُفتح
   * @returns سجلات الخدمات المعلّمة كاملة للتخطيط والتدقيق
   */
  lockMarkedServices(businessId: string, categoryId: string): Promise<ServiceRecord[]>;
  /**
   * يحفظ حالة التصنيف على نسخته المقفولة ويكتب أثر الخدمات في تحديث واحد مع تدقيق كل خدمة في نفس
   * الأمر، ويرفض تعارض النسخة.
   *
   * @param category التصنيف قبل العملية وبعدها
   * @param services الخدمات المتغيرة قبل العملية وبعدها
   * @returns اكتمال الحفظ الذري للتصنيف وخدماته
   */
  saveClosing(
    category: ServiceRecordChange<ServiceCategoryRecord>,
    services: readonly ServiceRecordChange<ServiceRecord>[],
  ): Promise<void>;
  /**
   * يدخل تدقيق التصنيف وحده في صف واحد؛ تدقيق الخدمات كاتبه أمر الكاسكاد مع تحديثها، فالأثر كله
   * ذري في أمر واحد.
   *
   * @param entries فعل العملية والتصنيف قبله وبعده
   * @returns اكتمال إدخال دفعة التدقيق
   */
  auditClosing(entries: ServiceCategoryClosingAudit): Promise<void>;
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
