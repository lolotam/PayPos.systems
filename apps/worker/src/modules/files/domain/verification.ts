/** النسخة المؤقتة المعلن عنها قبل فحص البايتات. */
export interface PendingFile {
  id: string;
  businessId: string;
  stagingKey: string;
  type: string;
  size: number;
}
/** نتيجة الفحص التي تصلح للنشر بمفتاح مستقل. */
export interface VerifiedFile {
  key: string;
  type: string;
  size: number;
}
/** رفض دائم للمحتوى برمز آمن دون بيانات الوثيقة. */
export class VerificationRejected extends Error {
  /**
   * يحفظ سبب فشل الفحص بدون بايتات أو بيانات حساسة.
   *
   * @param code رمز الرفض الدائم
   */
  constructor(readonly code: 'FILE_TYPE_INVALID' | 'FILE_SIZE_INVALID' | 'FILE_CONTENT_INVALID') {
    super(code);
  }
}
/**
 * انتهاء المهلة يتيح إعادة محاولة العامل دون إبقاء اتصال DB أثناء فحص الملف.
 *
 * @param at وقت المطالبة من الساعة المحقونة
 * @returns انتهاء مطالبة العامل بعد دقيقتين
 */
export function verificationDeadline(at: Date): Date {
  return new Date(at.getTime() + 120_000);
}
