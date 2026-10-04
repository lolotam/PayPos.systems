import type { DocumentTypeRecord } from '../domain/document-types.ts';

/** هوية الفاعل الموثقة ومفتاح إعادة الطلب لأوامر أنواع الوثائق. */
export interface DocumentTypeContext {
  companyId: string;
  userId: string;
  key: string;
  fingerprint: string;
}
/** خطوة الأمر التي تحتاجها حالة الاستخدام داخل معاملة الشركة الواحدة. */
export type DocumentTypeAction = 'create' | 'update' | 'deactivate' | 'reactivate';
/** معاملة النوع: الأقفال وإعادة فحص الصلاحية تسبق العمل، والتدقيق يلتزم معه. */
export interface DocumentTypeScope {
  /**
   * يعد أنواع الشركة كلها لأن سقف الأنواع يشمل الموقوف منها.
   *
   * @returns عدد الأنواع الحالي
   */
  count(): Promise<number>;
  /**
   * يحمل النوع مقفولاً حتى لا يتسابق تعديلان على نفس النسخة؛ غيابه يرفض كأنه غير موجود.
   *
   * @param typeId معرف النوع من المسار
   * @returns النوع المقفول
   */
  lock(typeId: string): Promise<DocumentTypeRecord>;
  /**
   * يحفظ النسخة الجديدة وسجل التدقيق قبل وبعد في نفس المعاملة.
   *
   * @param action الخطوة المنفذة لاسم التدقيق
   * @param before النسخة السابقة أو null عند الإنشاء
   * @param after النسخة الجديدة
   */
  save(
    action: DocumentTypeAction,
    before: DocumentTypeRecord | null,
    after: DocumentTypeRecord,
  ): Promise<void>;
}
/** الغلاف يعيد الرد المخزن للمفتاح المكرر بعد إعادة فحص الصلاحية، أو ينفذ مرة واحدة. */
export interface DocumentTypeTransactions {
  /**
   * ينفذ أمر النوع داخل معاملة واحدة مع Idempotency-Key.
   *
   * @param context السياق الموثق
   * @param operation اسم العملية لمفتاح إعادة الطلب
   * @param status حالة HTTP المخزنة مع الرد
   * @param work خطوة النطاق
   * @returns النوع كما حُفظ أو كما خُزن أول مرة
   */
  run(
    context: DocumentTypeContext,
    operation: string,
    status: 200 | 201,
    work: (scope: DocumentTypeScope) => Promise<DocumentTypeRecord>,
  ): Promise<DocumentTypeRecord>;
}
/** مصدر المعرفات المحقون يبقي الاختبارات حتمية. */
export interface DocumentIds {
  /** معرف UUID v7 لسجل جديد. */
  newId(): string;
}
/** الساعة المحقونة لوقت التسجيل ويوم الشارة. */
export interface DocumentClock {
  /** اللحظة الحالية من المحول المحقون. */
  now(): Date;
}
