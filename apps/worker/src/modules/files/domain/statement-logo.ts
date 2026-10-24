/** حدود الشعار في بيان الحضور: ضلع أقصى وحجم أقصى ومهلة القراءة من التخزين. */
export const STATEMENT_LOGO_LIMITS = {
  maxSide: 512,
  maxBytes: 512 * 1024,
  readTimeoutMs: 5_000,
} as const;

/** طلب قراءة شعار البيان: النشاط والملف المطلوب ومَن طلبه ومعرّف الرندر. */
export interface StatementLogoRequest {
  businessId: string;
  fileId: string;
  requesterUserId: string;
  renderId: string;
}

/** الشعار بعد التصغير، جاهز للتضمين في قالب البيان. */
export interface StatementLogo {
  content_type: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}

/** ما تسلّمه المرحلة الأولى للقراءة: مفتاح الشعار في التخزين ونوعه. */
export interface StatementLogoFile {
  storageKey: string;
  contentType: 'image/png' | 'image/jpeg';
}

/** عجز القارئ عن جلب الشعار؛ الرمز وحده هو اللي بيتبعت، من غير رسالة مزود ولا مفتاح. */
export class StatementLogoUnavailable extends Error {
  /**
   * يحفظ رمز العجز فقط: فشل المحاولة هو اللي بيخلّي BullMQ يعيدها مرة واحدة.
   *
   * @param code رمز العجز
   */
  constructor(readonly code: 'STORAGE_UNAVAILABLE' | 'READ_TIMEOUT' | 'ABORTED') {
    super(code);
  }
}

/**
 * قارئ شعار البيان: بياخد شركة الطلب والطلب نفسه وإلغاء المهلة، وبيرجّع الشعار أو null.
 * المصدر في documents بياخد الدالة دي من composition root، فمفيش استيراد لوحدة تانية.
 */
export type StatementLogoReader = (
  companyId: string,
  request: StatementLogoRequest,
  signal?: AbortSignal,
) => Promise<StatementLogo | null>;
