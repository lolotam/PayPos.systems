import type { ServiceCategoryLock } from '../domain/service-category-assignment.ts';
import type { ServiceRecord } from '../domain/service.ts';

/** كل عمليات الخدمة جوه معاملة شركة واحدة: إدخال، تحميل بقفل، حفظ، وتدقيق. */
export interface ServiceScope {
  /**
   * يحفظ خدمة جديدة داخل النشاط، والـ FK المركّب يمنع نشاط شركة تانية.
   *
   * @param record السجل الجاهز بالفلوس
   * @returns اكتمال الإدخال داخل المعاملة
   */
  insert(record: ServiceRecord): Promise<void>;
  /**
   * يحمل خدمة النشاط بقفل تحديث لتسلسل النسخ، أو null لو مش موجودة أو نشاط تاني.
   *
   * @param businessId النشاط المالك
   * @param serviceId الخدمة المستهدفة
   * @returns السجل الحالي المقفول أو غيابه
   */
  load(businessId: string, serviceId: string): Promise<ServiceRecord | null>;
  /**
   * يقرأ تصنيف الخدمة الحالي من غير قفل، عشان الـ use case يعرف التصنيف قبل ما يقفل.
   *
   * @param businessId النشاط المالك
   * @param serviceId الخدمة المستهدفة
   * @returns التصنيف الحالي، أو null لو الخدمة مش موجودة
   */
  peekCategoryId(
    businessId: string,
    serviceId: string,
  ): Promise<{ readonly category_id: string | null } | null>;
  /**
   * يقفل صفوف التصنيفات المطلوبة `FOR SHARE` بالترتيب المعطى، عشان الإغلاق المتزامن ما يسبقش التعيين.
   *
   * @param businessId النشاط المالك
   * @param categoryIds المعرّفات بالترتيب المطلوب للأقفال
   * @returns الصفوف الموجودة في النشاط، بمفتاح المعرّف
   */
  lockCategories(
    businessId: string,
    categoryIds: readonly string[],
  ): Promise<ReadonlyMap<string, ServiceCategoryLock>>;
  /**
   * يكتب النسخة التالية ويرفض لو حصل تعارض نسخة تحت القفل.
   *
   * @param before النسخة المحمّلة
   * @param after النسخة الجديدة
   * @returns اكتمال التحديث داخل المعاملة
   */
  save(before: ServiceRecord, after: ServiceRecord): Promise<void>;
  /**
   * يسجل snapshot مسموح الحقول قبل وبعد بفعل إنشاء أو تعديل أو إغلاق، وأي فشل يرد العملية كلها.
   *
   * @param before السجل السابق أو غيابه عند الإنشاء
   * @param after السجل بعد العملية
   * @param action إغلاق أو فتح الخدمة؛ غيابه يحافظ على تدقيق الإنشاء والتعديل
   * @returns اكتمال كتابة التدقيق
   */
  audit(
    before: ServiceRecord | null,
    after: ServiceRecord,
    action?: 'closed' | 'reopened',
  ): Promise<void>;
}

/** هوية الفاعل المتحقق منها داخل معاملة الخدمة؛ تتطلب شركة ومستخدم. */
export interface ServiceActor {
  readonly companyId: string;
  readonly userId: string;
}

/** حد معاملة الخدمة: يدخل الشركة المتحقق منها ويضم الإدخال والحفظ والتدقيق في commit واحد. */
export interface ServiceTransactions {
  /**
   * ينفّذ عملية الخدمة كلها في معاملة شركة واحدة، عشان الحفظ والتدقيق يتقبلوا أو يترفضوا مع بعض.
   *
   * @param actor هوية الفاعل المتحقق منها: الشركة والمستخدم
   * @param work عملية الخدمة على نطاق المعاملة
   * @returns ناتج العملية بعد نجاح commit
   */
  run<T>(actor: ServiceActor, work: (scope: ServiceScope) => Promise<T>): Promise<T>;
}
