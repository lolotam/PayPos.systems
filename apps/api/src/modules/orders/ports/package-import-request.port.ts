import type {
  PackageImportActor,
  PackageImportFileFacts,
  PendingPackagePreview,
} from '../domain/package-import-request.ts';

/** نطاق قبول واحد؛ صف المعاينة وحدثه لا يخرجان من هذه المعاملة. */
export interface PackageImportRequestScope {
  /** يثبت الإذن الحي وميزة orders للنشاط الحالي. */
  authorize(): Promise<void>;
  /**
   * يقرأ حقائق الملف وحدها من files على نفس المعاملة.
   *
   * @param fileId هوية الملف المطلوب
   * @returns حقائق الملف أو null للمجهول والخارج عن الشركة
   */
  fileFacts(fileId: string): Promise<PackageImportFileFacts | null>;
  /**
   * يحفظ pending بنتائج فارغة، بلا تحميل ملف أو إنشاء باقات.
   *
   * @param input هوية المعاينة والملف وتوقيت الطلب
   */
  createPending(input: PendingPackagePreview): Promise<void>;
  /**
   * يكتب حدث المعاينة بهويتها فقط داخل معاملة الصف نفسه.
   *
   * @param previewId هوية المعاينة الجديدة
   */
  publishRequested(previewId: string): Promise<void>;
}

/** حد المعاملة المستهلك من حالة استخدام طلب المعاينة. */
export interface PackageImportRequestTransactions {
  /**
   * ينفذ قبول الطلب تحت RLS وهوية صاحب الطلب.
   *
   * @param actor هوية الطلب المتحقق منها
   * @param work خطوات القبول داخل المعاملة
   * @returns نتيجة القبول بعد COMMIT فقط
   */
  run<T>(
    actor: PackageImportActor,
    work: (scope: PackageImportRequestScope) => Promise<T>,
  ): Promise<T>;
}
