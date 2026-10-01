/** معالجة ثانوية لا تعيد تطبيق STOP الذي تم قبل الرد على webhook. */
export interface WhatsappInboxRepository {
  /** يرجع معرّفات العمل غير المكتمل لاستعادته بعد سقوط العملية أو الطابور. */
  unfinished(): Promise<readonly string[]>;
  /**
   * يثبت نجاح enqueue من غير تغيير أمر أو بصمة رسالة.
   *
   * @param id UUID محفوظ
   * @param at وقت التأكيد
   */
  confirmEnqueue(id: string, at: Date): Promise<void>;
  /**
   * يعلّم الصف مرة واحدة من غير إعادة تطبيق المنع أو إنشاء audit.
   *
   * @param id UUID محفوظ
   * @param at وقت المعالجة
   */
  process(id: string, at: Date): Promise<void>;
  /**
   * يمسح JSON فقط بعد 30 يوم مع الاحتفاظ بهوية dedupe والتدقيق.
   *
   * @param at حد الاحتفاظ المحدد بقواعد المجال
   */
  clearPayloads(at: Date): Promise<number>;
}

/** واجهة تسليم UUID فقط للعمل الثانوي. */
export interface WhatsappInboundQueue {
  /**
   * التسليم الدائم قبل وضع علامة التأكيد.
   *
   * @param id UUID فقط
   */
  enqueue(id: string): Promise<void>;
}
