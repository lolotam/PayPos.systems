import type { DocumentTypeRecord } from '../domain/document-types.ts';
import type { DocumentFileFacts, EmployeeDocumentRecord } from '../domain/employee-documents.ts';

/** السياق الموثق لتسجيل وثيقة موظف ومفتاح إعادة الطلب. */
export interface EmployeeDocumentContext {
  companyId: string;
  userId: string;
  businessId: string;
  employeeId: string;
  key: string;
  fingerprint: string;
}
/** ما يراه الأمر بعد قفل الصلاحيات والموظف داخل معاملة الشركة. */
export interface EmployeeDocumentScope {
  /** منطقة النشاط الزمنية التي يحسب بها يوم الشارة. */
  readonly timeZone: string;
  /**
   * يقرأ حقائق الملف من files داخل نفس المعاملة؛ لا يوجد مفتاح يأتي من العميل.
   *
   * @param fileId معرف الملف المرفوع
   * @returns حقائق الملف أو null إن لم يكن في الشركة
   */
  file(fileId: string): Promise<DocumentFileFacts | null>;
  /**
   * يقرأ نوع الوثيقة بالكود لأن الوثائق تشير للكود الثابت لا للاسم.
   *
   * @param code كود النوع
   * @returns النوع أو null
   */
  type(code: string): Promise<DocumentTypeRecord | null>;
  /**
   * يعرف إن كان المفتاح مربوطاً بأي وثيقة في الشركة، حالية أو قديمة.
   *
   * @param objectKey مفتاح النسخة الموثقة
   * @returns هل سبق تسجيله
   */
  recorded(objectKey: string): Promise<boolean>;
  /**
   * يحمل الوثيقة الحالية للنوع مقفولة حتى يستبدلها تسجيل واحد فقط.
   *
   * @param typeCode كود النوع
   * @returns الوثيقة الحالية أو null
   */
  current(typeCode: string): Promise<EmployeeDocumentRecord | null>;
  /**
   * يحفظ الاستبدال والوثيقة الجديدة والتدقيق والحدث كوحدة واحدة.
   *
   * @param replaced الوثيقة القديمة بعد الاستبدال أو null
   * @param recorded الوثيقة الجديدة الحالية
   */
  save(replaced: EmployeeDocumentRecord | null, recorded: EmployeeDocumentRecord): Promise<void>;
}
/** الغلاف يعيد فحص الوصول ثم يعيد الرد المخزن أو ينفذ التسجيل مرة واحدة. */
export interface EmployeeDocumentTransactions {
  /**
   * ينفذ التسجيل داخل معاملة الشركة مع Idempotency-Key.
   *
   * @param context السياق الموثق
   * @param work خطوة النطاق
   * @returns الرد كما حُفظ أو كما خُزن أول مرة
   */
  run<T extends object>(
    context: EmployeeDocumentContext,
    work: (scope: EmployeeDocumentScope) => Promise<T>,
  ): Promise<T>;
}
