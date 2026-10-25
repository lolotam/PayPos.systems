export interface ObjectStorage {
  /**
   * يصدر قدرة PUT قصيرة ومقيدة بالبايتات والنوع دون جعل الحاوية عامة.
   *
   * @param key المفتاح الداخلي
   * @param type نوع المحتوى
   * @param size عدد البايتات
   * @returns نتيجة العملية المطلوبة
   */
  presignUpload(key: string, type: string, size: number): Promise<string>;
  /**
   * يصدر قدرة GET قصيرة بعد فحص صلاحية المستدعي في files.
   *
   * @param key المفتاح الداخلي
   * @param type نوع المحتوى
   * @returns نتيجة العملية المطلوبة
   */
  presignDownload(key: string, type: string): Promise<string>;
  /**
   * يقرأ بايتات محدودة في الذاكرة لكي لا يستنزف الملف المزيف العامل.
   * الإشارة، لو بتيت، بتلغي الطلب الجاري وقت ما تتلغى؛ من غيرها الطلب بيفضل شغّال في الخلفية
   * وبيتحمّل الملف من غير حدّ، والمحاولة اللي فشلت ممكن تتقاطع مع تحميل متروك.
   *
   * @param key المفتاح الداخلي
   * @param maxBytes حد الذاكرة
   * @param signal إلغاء اختياري للطلب الجاري
   * @returns نتيجة العملية المطلوبة
   */
  read(key: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>;
  /**
   * ينشر نسخة موثقة تحت مفتاح جديد لا يقبل استبدال النسخة الموجودة.
   *
   * @param key المفتاح الداخلي
   * @param bytes بايتات المحتوى
   * @param type نوع المحتوى
   * @returns نتيجة العملية المطلوبة
   */
  put(key: string, bytes: Uint8Array, type: string): Promise<void>;
  /**
   * يمسح جسماً داخلياً مملوكاً؛ الاستدعاء لا يستهدف الوثيقة المنشورة.
   *
   * @param key المفتاح الداخلي
   * @returns نتيجة العملية المطلوبة
   */
  remove(key: string): Promise<void>;
  /**
   * يحرر اتصال المزود عند إغلاق التطبيق.
   *
   * @returns نتيجة العملية المطلوبة
   */
  close(): void;
}
export class StorageError extends Error {
  constructor() {
    super('STORAGE_UNAVAILABLE');
  }
}

/**
 * الكائن المطلوب غير موجود (404). القارئ يفرّق بينه وبين انقطاع التخزين: الأول «مفيش ملف» والآخر عطل.
 * الرسالة وريث رسالة الأب، فكل فحص `instanceof StorageError` بيفضل شغّال.
 */
export class StorageObjectMissingError extends StorageError {}
