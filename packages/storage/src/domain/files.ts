/** سياسة أنواع وحدود حجم مقيدة بقرار المالك. */
export type UploadPolicy = Readonly<Record<string, number>>;
/** owner decision 2026-10-03: الأنواع الثلاثة فقط، 10 MiB لكل منها. */
export const FILE_UPLOAD_POLICY: UploadPolicy = Object.freeze({
  'application/pdf': 10 * 1024 * 1024,
  'image/jpeg': 10 * 1024 * 1024,
  'image/png': 10 * 1024 * 1024,
});
/** أسباب رفض محتوى آمنة وقابلة للترجمة. */
export type FileFailure = 'FILE_TYPE_INVALID' | 'FILE_SIZE_INVALID' | 'FILE_CONTENT_INVALID';

/** فشل تحقق محتوى دون تسريب البايتات أو المفتاح. */
export class FileValidationError extends Error {
  /**
   * يحفظ رمز الرفض الآمن فقط دون محتوى الوثيقة.
   *
   * @param code سبب الرفض
   */
  constructor(readonly code: FileFailure) {
    super(code);
  }
}

/**
 * يمنع إدخال أسماء ملفات أو مسارات من العميل إلى مساحة الشركة.
 *
 * @param companyId الشركة المالكة
 * @param businessId النشاط المالك
 * @param objectId هوية يولدها السيرفر
 * @param area فصل المؤقت عن النسخة الموثقة
 * @returns مفتاح بدون أي اسم ملف من المستخدم
 */
export function buildObjectKey(
  companyId: string,
  businessId: string,
  objectId: string,
  area: 'staging' | 'verified',
): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (![companyId, businessId, objectId].every((id) => uuid.test(id)))
    throw new Error('FILE_KEY_INVALID');
  if (area !== 'staging' && area !== 'verified') throw new Error('FILE_KEY_INVALID');
  return `${companyId.toLowerCase()}/${businessId.toLowerCase()}/${area}/${objectId.toLowerCase()}`;
}

/**
 * السياسة الصريحة وحدها تفتح النوع؛ الحجم المعلن لا يغني عن فحص البايتات.
 *
 * @param policy أنواع وحدود اعتمدها المشغل بعد قرار المالك
 * @param contentType النوع المطلوب
 * @param size الحجم المطلوب أو المقروء فعلياً
 * @returns الحد المسموح للنوع
 */
export function validateUpload(policy: UploadPolicy, contentType: string, size: number): number {
  const max = Object.hasOwn(policy, contentType) ? policy[contentType] : undefined;
  if (max === undefined || !Object.hasOwn(FILE_UPLOAD_POLICY, contentType))
    throw new FileValidationError('FILE_TYPE_INVALID');
  if (!Number.isSafeInteger(size) || size <= 0 || size > max || size > 10 * 1024 * 1024)
    throw new FileValidationError('FILE_SIZE_INVALID');
  return max;
}

/**
 * يقارن النوع المكتشف والحجم الفعلي بالتصريح قبل نشر الملف.
 *
 * @param policy حدود الأنواع المفعلة
 * @param declared تصريح الرفع
 * @param detected نتيجة فحص المحتوى
 * @returns لا شيء إذا كان المحتوى مطابقاً
 */
export function validateContent(
  policy: UploadPolicy,
  declared: DeclaredContent,
  detected: DetectedContent,
): void {
  validateUpload(policy, declared.type, detected.size);
  if (detected.size !== declared.size) throw new FileValidationError('FILE_SIZE_INVALID');
  if (detected.type !== declared.type) throw new FileValidationError('FILE_TYPE_INVALID');
}

interface DeclaredContent {
  type: string;
  size: number;
}
interface DetectedContent {
  type: string | undefined;
  size: number;
}
