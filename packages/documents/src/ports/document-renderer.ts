export interface RenderOptions {
  readonly signal?: AbortSignal;
}

/**
 * محوّل الرندر. التنفيذ بيقفل جافاسكربت والشبكة؛ البورت نفسه ما بيعرفش Playwright.
 */
export interface DocumentRenderer {
  /**
   * بيجهّز متصفح العملية مرة واحدة.
   * فشل الإطلاق الأول مش بيوقع الوركر؛ المحوّل بيعلّم نفسه غير متاح ويعيد المحاولة.
   *
   * @returns بعد ما المحاولة الأولى تخلّص أو تتجدول
   */
  start(): Promise<void>;

  /**
   * بيقفل المتصفح ويمنع إعادة الإطلاق وقت الإيقاف.
   *
   * @returns بعد إغلاق المتصفح
   */
  close(): Promise<void>;

  /**
   * بيقول لو في متصفح جاهز يستقبل صفحة.
   *
   * @returns صح لما Chromium متوصل
   */
  isAvailable(): boolean;

  /**
   * بيتنادى لما المتصفح يقع عشان مفتاح الحياة يتمسح فورًا.
   *
   * @param listener مستمع البنية التحتية، مش سجل
   * @returns لا شيء
   */
  onUnavailable(listener: () => void): void;

  /**
   * بيتنادى لما المتصفح يرجع عشان مفتاح الحياة يتجدد.
   *
   * @param listener مستمع البنية التحتية، مش سجل
   * @returns لا شيء
   */
  onAvailable(listener: () => void): void;

  /**
   * بيحوّل HTML جاهز لبايتات PDF.
   * الصفحة من غير جافاسكربت ومن غير شبكة، والسياق بيتقفل حتى لو الرندر فشل.
   *
   * @param html المستند الكامل بعد القالب
   * @param options إشارة الإلغاء الاختيارية
   * @returns بايتات PDF
   */
  render(html: string, options?: RenderOptions): Promise<Uint8Array>;
}
