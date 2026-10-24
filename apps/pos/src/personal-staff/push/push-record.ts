/**
 * سجل الإشعارات المحلي على الجهاز: توكن التسليم ومرجع المشترك والشركة ومعرف مفتاح VAPID
 * وحالة التعليق. مش بيانات خاصة: التوكن عشوائي ومرجع المشترك مش قابل للعكس (ADR-0052 §7).
 */
export interface PushRecord {
  token: string;
  subscriber_ref: string;
  company_id: string;
  vapid_key_id: string;
  suspended: boolean;
}

/**
 * مخزن السجل المحلي: القراءة والكتابة والحذف. بيتشترك فيه التطبيق والـ service worker،
 * فبيشتغل على IndexedDB الخام من غير أي اعتماد على React أو على DOM.
 */
export interface PushRecordStore {
  read(): Promise<PushRecord | null>;
  write(record: PushRecord): Promise<void>;
  remove(): Promise<void>;
}
