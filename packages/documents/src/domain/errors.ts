/**
 * بيرفض مستند أكبر من سقف الذاكرة المتفق عليه.
 * البايتات الزايدة ما تتبعتش لـ Chromium ولا تتكتب في Redis.
 */
export class DocumentTooLargeError extends Error {
  readonly code = 'DOCUMENT_TOO_LARGE' as const;

  /**
   * بيسجّل أي سقف اتكسر من غير ما يحط حجم المحتوى في الرسالة.
   *
   * @param limit أي سقف اتكسر: HTML قبل الرندر أو PDF بعده
   */
  constructor(readonly limit: 'html' | 'pdf') {
    super('DOCUMENT_TOO_LARGE');
    this.name = 'DocumentTooLargeError';
  }
}

/**
 * مهلة الصفحة أو المهلة الكلية خلصت.
 * السياق بيتقفل عشان متصفح واحد معلّق ما يبلوكش الطابور.
 */
export class DocumentRenderTimeoutError extends Error {
  readonly code = 'DOCUMENT_RENDER_TIMEOUT' as const;

  /** الرسالة كود ثابت عشان Redis ما يخزّنش نص الصفحة. */
  constructor() {
    super('DOCUMENT_RENDER_TIMEOUT');
    this.name = 'DocumentRenderTimeoutError';
  }
}

/**
 * مفيش متصفح جاهز. الشغل بيتأجل لإعادة المحاولة بدل ما يتعلم فشل نهائي من أول مرة.
 */
export class DocumentRendererUnavailableError extends Error {
  readonly code = 'DOCUMENT_RENDER_FAILED' as const;

  /** الكود عام؛ سبب الإطلاق بيتسجل في حدث من غير مسار المتصفح. */
  constructor() {
    super('DOCUMENT_RENDER_FAILED');
    this.name = 'DocumentRendererUnavailableError';
  }
}
