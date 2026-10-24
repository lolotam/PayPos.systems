/**
 * سجل الإشعارات المحلي على الجهاز: توكن التسليم ومرجع المشترك والشركة ومفتاح VAPID
 * وحالة التعليق. مش بيانات خاصة: التوكن عشوائي ومرجع المشترك مش قابل للعكس (ADR-0052 §7).
 */
export interface PushRecord {
  token: string;
  subscriber_ref: string;
  company_id: string;
  vapid_key_id: string;
  suspended: boolean;
}

/** خيارات الكتابة المحروسة: التعليق بيتشال بس لما الطلب يقول صريح. */
export interface PushWriteOptions {
  clearSuspension?: boolean;
  expectToken?: string | null;
}

/**
 * مخزن السجل المحلي: القراءة والكتابة والحذف، وبيشتغل في المتصفح وفي الـ service worker.
 * جيل السجل كمان بيتخزن فيه عشان كل التبويبات تشوف نفس الرقم (ADR-0052 §7).
 */
export interface PushRecordStore {
  read(): Promise<PushRecord | null>;
  write(record: PushRecord): Promise<void>;
  remove(): Promise<void>;
  generation(): Promise<number>;
  bumpGeneration(): Promise<number>;
  writeIfGeneration(
    record: PushRecord,
    expected: number,
    options?: PushWriteOptions,
  ): Promise<boolean>;
}
