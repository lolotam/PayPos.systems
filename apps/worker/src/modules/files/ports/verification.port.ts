import type { PendingFile, VerifiedFile, VerificationRejected } from '../domain/verification.ts';

/** حد مطالبة الفحص والنشر المشروط داخل الشركة. */
export interface VerificationRepository {
  /**
   * يقفل الصف لحظة المطالبة ثم يحرر الاتصال قبل أي IO خارجي.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @param leaseId هوية محاولة العامل
   * @param at وقت القرار
   * @param until انتهاء المطالبة
   * @returns نتيجة العملية المطلوبة
   */
  claim(
    companyId: string,
    fileId: string,
    leaseId: string,
    at: Date,
    until: Date,
  ): Promise<PendingFile | null>;
  /**
   * ينشر المفتاح المفحوص فقط إذا ما زالت المطالبة تخص نفس العامل.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @param leaseId هوية محاولة العامل
   * @param result النسخة المفحوصة
   * @returns نتيجة العملية المطلوبة
   */
  complete(
    companyId: string,
    fileId: string,
    leaseId: string,
    result: VerifiedFile,
  ): Promise<boolean>;
  /**
   * يجعل رفض المحتوى نهائياً مع رمز آمن بدلاً من خطأ المزود.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @param leaseId هوية محاولة العامل
   * @param code رمز الرفض الآمن
   * @param at وقت الرفض لبدء الاحتفاظ بسبعة أيام
   * @returns نتيجة العملية المطلوبة
   */
  reject(
    companyId: string,
    fileId: string,
    leaseId: string,
    code: VerificationRejected['code'],
    at: Date,
  ): Promise<void>;
  /**
   * يحرر المطالبة بعد فشل خارجي كي تعيد BullMQ المحاولة فوراً.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @param leaseId هوية محاولة العامل
   * @returns نتيجة العملية المطلوبة
   */
  release(companyId: string, fileId: string, leaseId: string): Promise<void>;
}
/** حد قراءة المحتوى وفحصه وإعادة ترميزه خارج المعاملة. */
export interface VerificationStorage {
  /**
   * يقرأ بايتات محدودة ويفحصها ويعيد ترميز الصور ثم يكتب نسخة بمفتاح جديد.
   *
   * @param companyId الشركة الموثقة
   * @param file سجل الملف
   * @param candidateId هوية نسخة جديدة
   * @returns نتيجة العملية المطلوبة
   */
  verify(
    companyId: string,
    file: PendingFile,
    candidateId: string,
  ): Promise<{ key: string; type: string; size: number }>;
  /**
   * يحذف المؤقت بعد نجاح النشر؛ الفشل لا يلغي صلاحية النسخة الموثقة.
   *
   * @param key المفتاح الداخلي
   * @returns نتيجة العملية المطلوبة
   */
  removeStaging(key: string): Promise<void>;
}
/** مصدر الوقت المحقون لمطالبات العامل. */
export interface Clock {
  /**
   * يثبت وقت المطالبة للاختبار وللتعافي من crash.
   *
   * @returns نتيجة العملية المطلوبة
   */
  now(): Date;
}
/** مصدر هوية مستقل لكل محاولة ولكل نسخة موثقة. */
export interface IdGenerator {
  /**
   * يميز كل محاولة ومفتاحها عن الروابط والمحاولات السابقة.
   *
   * @returns نتيجة العملية المطلوبة
   */
  newId(): string;
}
