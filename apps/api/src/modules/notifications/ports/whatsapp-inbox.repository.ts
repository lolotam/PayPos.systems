import type { ScrubbedWhatsappMessage } from '../domain/whatsapp-command.ts';

/** الاستقبال يثبت STOP قبل إرسال أي job حتى لا تمدد الطوابير نافذة الإرسال. */
export interface WhatsappInboxRepository {
  /**
   * يحفظ الرسائل والبصمات والمنع والتدقيق في معاملة واحدة ثم يرجع معرّفات inbox.
   *
   * @param messages رسائل scrubbed فقط
   * @param at وقت الاستقبال المتحقن
   */
  accept(messages: readonly ScrubbedWhatsappMessage[], at: Date): Promise<readonly string[]>;
  /**
   * يثبت نجاح التسليم للطابور بعد commit دون تغيير هوية dedupe.
   *
   * @param id UUID محفوظ
   * @param at وقت التأكيد
   */
  confirmEnqueue(id: string, at: Date): Promise<void>;
}

/** الطابور يحمل UUID فقط ولا يعرف رسالة المزود أو الهاتف. */
export interface WhatsappInboundQueue {
  /**
   * ينتظر التسليم المحدود قبل الرد أو يترك السجل للـ sweep عند الفشل.
   *
   * @param id UUID فقط بدون هاتف
   */
  enqueue(id: string): Promise<void>;
}
