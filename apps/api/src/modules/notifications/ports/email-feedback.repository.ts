/**
 * الحدث المنقّح الواحد: بصمة دائمة للحدث، ومعرّف الإيميل عند المزود، وتصنيف الارتداد.
 * العنوان نفسه مش جزء من النوع ده: بيشتغل في الذاكرة وقت الاستقبال بس.
 */
export interface EmailFeedbackEvent {
  /** بصمة دائمة للحدث (HMAC مفضل بمفتاح الويبيوك)؛ دي اللي بيميّز إعادة التسليم. */
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
   */
  accept(event: EmailFeedbackEvent, at: Date): Promise<{ id: string; inserted: boolean }>;
  /**
   * يثبت نجاح التسليم للطابور بعد commit، من غير ما يغيّر هوية الحدث.
   *
   * @param id UUID محفوظ
   * @param at وقت التأكيد
   */
  confirmEnqueue(id: string, at: Date): Promise<void>;
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
