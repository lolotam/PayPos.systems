import type { PackageImportActor } from '../domain/package-import-request.ts';

/** اسما خدمة مفتوحة كما يعرضهما القالب؛ الاستيراد يطابق الأسماء لا المعرفات. */
export interface PackageImportTemplateService {
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** نطاق قراءة القالب: خدمات النشاط المفتوحة فقط على معاملة واحدة. */
export interface PackageImportTemplateScope {
  /**
   * يقرأ أسماء الخدمات المفتوحة للنشاط (SI-Q28) بسقف يزيد واحداً على سعة القالب، ليرفض الفحص الزائد بدل القص.
   *
   * @param businessId النشاط المطلوب
   * @returns الخدمات المفتوحة مرتبة بالاسم الإنجليزي
   */
  services(businessId: string): Promise<readonly PackageImportTemplateService[]>;
}

/** حد المعاملة المستهلك من حالة استخدام تنزيل القالب. */
export interface PackageImportTemplateTransactions {
  /**
   * يثبت الإذن الحي وميزة orders ثم يقرأ الحقائق على المعاملة نفسها؛ لا يكتب شيئاً.
   *
   * @param actor هوية الطلب المتحقق منها
   * @param work قراءة الحقائق داخل المعاملة
   * @returns ما رجعت به القراءة
   */
  runFacts<T>(
    actor: PackageImportActor,
    work: (scope: PackageImportTemplateScope) => Promise<T>,
  ): Promise<T>;
}

/** بنّاء المصنف: يحوّل أسماء الخدمات المقبولة إلى ملف xlsx جاهز بعد مروره على القارئ المحمي. */
export interface PackageImportTemplateBuilder {
  /**
   * يبني القالب ويتحقق منه بالقارئ المحمي نفسه قبل التنزيل.
   *
   * @param services الخدمات المفتوحة المقبولة سعتها
   * @returns المصنف مشفراً بـ base64
   */
  build(services: readonly PackageImportTemplateService[]): Promise<string>;
}
