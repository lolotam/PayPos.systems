import type { FileRecord } from '../domain/file.ts';

/** هوية الشركة والمستخدم بعد تحقق حراس الوصول. */
export interface Actor {
  companyId: string;
  userId: string;
}
/** بيانات طلب جديد قبل الفحص والنشر. */
export interface NewFile extends Omit<FileRecord, 'status' | 'storageKey' | 'branchId'> {
  branchId: string | null;
  ownerModule: string;
  ownerEntityId: string;
  createdAt: Date;
}
/** حد التخزين المعاملاتي للملفات وسجل الوصول. */
export interface FileRepository {
  /**
   * يحفظ طلباً معزولاً بعد التحقق من مرجع النشاط والفرع.
   *
   * @param actor هوية المستدعي الموثقة
   * @param file سجل الملف
   * @returns نتيجة العملية المطلوبة
   */
  create(actor: Actor, file: NewFile): Promise<void>;
  /** يثبت التأكيد قبل Redis ويمنع السباق مع مطالبة حذف المهجور.
   *
   * @param actor هوية المستدعي
   * @param id هوية الملف
   * @param at وقت التأكيد
   * @returns هل ما زال التأكيد مسموحاً
   */
  confirm(actor: Actor, id: string, at: Date): Promise<boolean>;
  /**
   * يسترجع الهوية اللازمة لأوامر الرفع والتنزيل دون تخطي RLS.
   *
   * @param actor هوية المستدعي الموثقة
   * @param id هوية يولدها السيرفر
   * @returns نتيجة العملية المطلوبة
   */
  find(actor: Actor, id: string): Promise<FileRecord | null>;
  /**
   * يحل مفتاح الوثيقة الذي يحفظه staff داخل شركة المستدعي فقط.
   *
   * @param actor هوية المستدعي الموثقة
   * @param key المفتاح المحفوظ للنسخة الموثقة
   * @returns سجل الملف أو لا شيء إذا لم يكن داخل الشركة
   */
  findByKey(actor: Actor, key: string): Promise<FileRecord | null>;

  /**
   * يثبت قرار إصدار القدرة في سجلي الوصول والتدقيق قبل الرد.
   *
   * @param actor هوية المستدعي الموثقة
   * @param fileId هوية الملف
   * @param outcome قرار السماح أو الرفض
   * @param at وقت القرار
   * @returns نتيجة العملية المطلوبة
   */
  audit(actor: Actor, fileId: string, outcome: 'ALLOW' | 'DENY', at: Date): Promise<void>;
}
/** حد إصدار قدرات التخزين الخاصة دون كشف تفاصيل المزود. */
export interface FileStorage {
  /**
   * يفحص تصريح الرفع ثم يبني المفتاح ورابط PUT المقيد من طرف السيرفر.
   *
   * @param actor هوية المستدعي الموثقة
   * @param businessId النشاط المالك
   * @param id هوية يولدها السيرفر
   * @param type نوع المحتوى
   * @param size عدد البايتات
   * @returns نتيجة العملية المطلوبة
   */
  upload(
    actor: Actor,
    businessId: string,
    id: string,
    type: string,
    size: number,
  ): Promise<{ key: string; url: string }>;
  /**
   * يصدر GET قصير لا يسمح بفتح محتوى نشط داخل المتصفح.
   *
   * @param key المفتاح الداخلي
   * @param type نوع المحتوى
   * @returns نتيجة العملية المطلوبة
   */
  download(key: string, type: string): Promise<string>;
}
/** حد تقييم الصلاحية المحفوظة عند وقت الطلب. */
export interface FilePermissions {
  /**
   * يعيد تقييم المنح والرفض والانتهاء الآن عند النطاق المحفوظ.
   *
   * @param actor هوية المستدعي الموثقة
   * @param permission الصلاحية المطلوبة
   * @param businessId النشاط المالك
   * @param branchId الفرع المحفوظ
   * @returns نتيجة العملية المطلوبة
   */
  allowed(
    actor: Actor,
    permission: string,
    businessId: string,
    branchId: string | null,
  ): Promise<boolean>;
}
/** حد إرسال هويات الملفات فقط للعامل. */
export interface FileQueue {
  /**
   * يرسل الهويات فقط للعامل كي لا تعبر الوثيقة أو المفتاح إلى Redis.
   *
   * @param companyId الشركة الموثقة
   * @param fileId هوية الملف
   * @returns نتيجة العملية المطلوبة
   */
  enqueue(companyId: string, fileId: string): Promise<void>;
}
/** مصدر الوقت المحقون لحالات الاستخدام. */
export interface Clock {
  /**
   * يثبت وقت القرار بدون ساعة مخفية داخل حالة الاستخدام.
   *
   * @returns نتيجة العملية المطلوبة
   */
  now(): Date;
}
/** مصدر هويات UUID v7 المحقون. */
export interface IdGenerator {
  /**
   * يولد UUID v7 من المحول المحقون للملفات وسجل التدقيق.
   *
   * @returns نتيجة العملية المطلوبة
   */
  newId(): string;
}
