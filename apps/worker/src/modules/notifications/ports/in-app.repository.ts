import type { InAppInput } from '../domain/in-app-notification.ts';

/** حفظ الإشعار ونتيجته على نفس معاملة المستهلك حتى لا يظهر نجاح بلا صف. */
export interface InAppRepository {
  /**
   * يرجع هل أُنشئ صف جديد، حتى لا تنشر إعادة التسليم نتيجة ثانية.
   *
   * @param input سياق المستلم والمصدر والقالب الآمن
   * @param id هوية الإشعار
   * @param eventId هوية نتيجة التخزين
   * @param now وقت الإنشاء
   */
  insert(input: InAppInput, id: string, eventId: string, now: Date): Promise<boolean>;
}
