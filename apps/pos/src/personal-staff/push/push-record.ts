/**
 * سجل الإشعارات المحلي على الجهاز: توكن التسليم ومرجع المشترك والشركة ومفتاح VAPID
 * وحالة التعليق ورقم المراجعة. مش بيانات خاصة: التوكن عشوائي ومرجع المشترك مش قابل
 * للعكس (ADR-0052 §7).
 */
export interface PushRecord {
  token: string;
  subscriber_ref: string;
  company_id: string;
  vapid_key_id: string;
  suspended: boolean;
  /** رقم بيزيد مع كل تعليق: بيقول إن التعليق ده جديد ولا من قديم. */
  revision: number;
}

/** خيارات الكتابة المحروسة: التعليق بيتشال صريح، والمراجعة والتوكن بيمنعوا كتابة قديمة. */
export interface PushWriteOptions {
  clearSuspension?: boolean;
  expectRevision?: number;
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
  /** بيمسح بس السجل المتوقع، عشان تنظيف قديم ما يمسحش تسجيل تبويب تاني. */
  removeIfMatches(expected: { token: string | null; revision: number }): Promise<boolean>;
  /** بيرجع مراجعة التعليق الجديد، أو صفر لو السجل اتمسح قبل التعليق. */
  suspend(): Promise<number>;
  generation(): Promise<number>;
  bumpGeneration(): Promise<number>;
  writeIfGeneration(
    record: PushRecord,
    expected: number,
    options?: PushWriteOptions,
  ): Promise<boolean>;
}
