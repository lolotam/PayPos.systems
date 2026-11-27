/**
 * بيرفض مستند أكبر من سقف الذاكرة المتفق عليه.
 * البايتات الزايدة ما تتبعتش لـ Chromium ولا تتكتب في Redis.
 */
export class DocumentTooLargeError extends Error {
  readonly code = 'DOCUMENT_TOO_LARGE' as const;

  /**
   * بيسجّل أي سقف اتكسر من غير ما يحط حجم المحتوى في الرسالة.
   *
   * @param limit أي سقف اتكسر: HTML قبل الرندر أو PDF بعده أو بايتات المستند قبل الكتابة
   */
  constructor(readonly limit: 'html' | 'pdf' | 'bytes') {
    super('DOCUMENT_TOO_LARGE');
    this.name = 'DocumentTooLargeError';
  }
}

/**
 * مهلة الطباعة أو المهلة الكلية خلصت.
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
 * مفيش متصفح جاهز للصفحة.
 * الكود ثابت عشان BullMQ ما يخزّنش مسار المتصفح ولا محتوى الصفحة.
 * تشخيص الإطلاق رمز من قائمة ثابتة، مش نص الخطأ.
 */
export class DocumentRendererUnavailableError extends Error {
  readonly code = 'DOCUMENT_RENDER_FAILED' as const;

  /** الرسالة كود ثابت، والسجل ما بينقلش نص الخطأ. */
  constructor() {
    super('DOCUMENT_RENDER_FAILED');
    this.name = 'DocumentRendererUnavailableError';
  }
}

/**
 * بيقول إن الخطأ ده مهلة رندر: إما مهلة الطباعة بتاعتنا، أو مهلة Playwright نفسها.
 *
 * @param error الخطأ المرفوض من الرندر
 * @returns صح لما الخطأ مهلة، مش فشل تاني
 */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof DocumentRenderTimeoutError ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

/**
 * بيحوّل أي فشل غير معروف لخطأ نطاق معروف، عشان الـ API يحوّله لكود ثابت.
 *
 * @param error الخطأ المرفوض من الرندر
 * @returns خطأ النطاق: مهلة، مستند كبير، متصفح غير متاح، أو الخطأ الأصلي
 */
export function asRendererError(error: unknown): Error {
  if (error instanceof DocumentRenderTimeoutError) return error;
  if (error instanceof DocumentTooLargeError) return error;
  if (error instanceof DocumentRendererUnavailableError) return error;
  if (isTimeoutError(error)) return new DocumentRenderTimeoutError();
  if (error instanceof Error) return error;
  return new Error('DOCUMENT_RENDER_FAILED');
}
