import type {
  PendingFile,
  VerifiedFile,
  VerificationRejected,
  InspectedFile,
} from '../domain/verification.ts';

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
  /** يحفظ ملكية المفتاح قبل PUT ويجدد المطالبة السارية؛ الفشل لا يسمح بالكتابة.
   *
   * @param companyId الشركة
   * @param fileId الملف
   * @param leaseId مطالبة التحقق
   * @param candidateId هوية النسخة
   * @param key المفتاح الداخلي المولد
   * @param at وقت حجز الملكية
   * @param until نهاية المطالبة المجددة
   * @returns هل تم حجز الملكية قبل الكتابة
   */
  reserve(
    companyId: string,
    fileId: string,
    leaseId: string,
    candidateId: string,
    key: string,
    at: Date,
    until: Date,
  ): Promise<boolean>;
  /**
   * ينشر المفتاح المفحوص فقط إذا ما زالت المطالبة تخص نفس العامل.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @param leaseId هوية محاولة العامل
   * @param result النسخة المفحوصة
   * @param at وقت النشر والتحقق من انتهاء المطالبة
   * @returns نتيجة العملية المطلوبة
   */
  complete(
    companyId: string,
    fileId: string,
    leaseId: string,
    result: VerifiedFile,
    at: Date,
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
  /** يفحص البايتات ويعيد ترميز الصور قبل امتلاك نسخة قابلة للنشر.
   *
   * @param file بيانات الجسم المؤقت
   * @returns محتوى مفحوص محدود في الذاكرة
   */
  inspect(file: PendingFile): Promise<InspectedFile>;
  /** يولد مفتاحاً مستقلاً عن PUT دون كتابته قبل تسجيل ملكيته.
   *
   * @param companyId الشركة
   * @param businessId النشاط
   * @param candidateId هوية النسخة
   * @returns مفتاح مرشح مولد
   */
  candidateKey(companyId: string, businessId: string, candidateId: string): string;
  /** يكتب المفتاح المملوك مسبقاً خارج المعاملة.
   *
   * @param key المفتاح المسجل
   * @param content البايتات المفحوصة
   * @returns ينتهي عند كتابة النسخة المستقلة
   */
  write(key: string, content: InspectedFile): Promise<void>;
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
