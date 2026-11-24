/**
 * الحدث المنقّح الواحد: بصمة دائمة للحدث، ومعرّف الإيميل عند المزود، وتصنيف الارتداد.
 * العنوان نفسه مش جزء من النوع ده: بيشتغل في الذاكرة وقت الاستقبال بس.
 */
export interface EmailFeedbackEvent {
  /** بصمة دائمة بمفتاح مستقل ثابت؛ دي اللي بتميّز إعادة التسليم بعد تدوير سر التوقيع. */
  readonly digest: Buffer;
  /** نوع الحدث المسموح به من المزود. */
  readonly type: string;
  /** معرّف الإيميل عند المزود؛ معرّف غامض مش محمول عنوان. */
  readonly emailId: string;
  /** تصنيف الارتداد: دائم، مؤقت، أو مجهول (ما بيمنعش الحظر). */
  readonly bounceClass: 'PERMANENT' | 'TRANSIENT' | null;
  /** وقت المزود للحدث. */
  readonly providerTimestamp: Date;
  /** الغلاف المنقّح اللي بيتخزن: معرّفات وأوقات فقط. */
  readonly envelope: {
    readonly type: string;
    readonly created_at: string;
    readonly email_id: string;
    readonly bounce_type?: string;
  };
}

/** الاستقبال يثبت الحدث قبل أي طابور، فالعنوان مش بيفضل في أي مكان. */
export interface EmailFeedbackInboxRepository {
  /**
   * يحفظ الحدث المنقّح في معاملة واحدة، keyed by the digest؛ التكرار ما بيعملش صف تاني.
   *
   * @param event الحدث المنقّح
   * @param at وقت الاستقبال المتحقن
   * @param remainingMs ميزانية التخزين الباقية من الطلب
   */
  accept(
    event: EmailFeedbackEvent,
    at: Date,
    remainingMs: number,
  ): Promise<{ id: string; inserted: boolean }>;
  /**
   * يثبت نجاح التسليم للطابور بعد commit، من غير ما يغيّر هوية الحدث.
   *
   * @param id UUID محفوظ
   * @param at وقت التأكيد
   * @param remainingMs ميزانية التأكيد الباقية من الطلب
   */
  confirmEnqueue(id: string, at: Date, remainingMs: number): Promise<void>;
}

/** الطابور يحمل UUID فقط، ومفيش عنوان ولا بيانات مزود. */
export interface EmailFeedbackQueue {
  /**
   * ينتظر التسليم المحدود قبل الرد ضمن الموعد نفسه؛ ما عداه بيرفض فيسيب الصف للـ sweep.
   *
   * @param id UUID فقط
   * @param deadline الموعد المشترك للاستقبال كله
   */
  enqueue(id: string, deadline: Date): Promise<void>;
}

/** تعذّر التسليم للطابور؛ الصف الدائم يفضل متاح لاسترداد العامل. */
export class EmailFeedbackQueueUnavailableError extends Error {
  /** ينشئ فشل التسليم المتوقع من غير تفاصيل اتصال أو بيانات مزود. */
  constructor() {
    super('EMAIL_FEEDBACK_QUEUE_UNAVAILABLE');
    this.name = 'EmailFeedbackQueueUnavailableError';
  }
}
