/** صلاحية طلب التثبيت: يوم واحد، زي صلاحية المعاينة نفسها (CIM-08). */
export const CUSTOMER_IMPORT_COMMIT_TTL_MS = 86_400_000;

/** عمر الطلب قبل ما المسح يعتبره عالقاً: خمس دقائق. */
export const CUSTOMER_IMPORT_STALE_MS = 300_000;

/** أقصى عدد صفحات يمسحها المسح في دورة واحدة. */
export const CUSTOMER_IMPORT_RECOVERY_MAX_PAGES = 10;

/** رفض دائم وآمن يسمح للعامل بإنهاء الطلب بعد التراجع عن المعاملة. */
export class CustomerImportCommitError extends Error {
  /**
   * يحتفظ برمز الرفض فقط دون بيانات المصدر أو تفاصيل قاعدة البيانات.
   *
   * @param code رمز رفض آمن دون تفاصيل المصدر
   */
  constructor(
    readonly code: 'IMPORT_PREVIEW_EXPIRED' | 'IMPORT_PREVIEW_HAS_ERRORS' | 'IMPORT_COMMIT_FAILED',
  ) {
    super(code);
    this.name = 'CustomerImportCommitError';
  }
}

/** صف التثبيت كما خُزن في المعاينة: قيمه جاهزة للكتابة بلا أخطاء. */
export interface CustomerImportCommitRow {
  readonly row: number;
  readonly name: string;
  readonly phone: string;
  readonly masked_phone: string;
  readonly locale: 'ar' | 'en';
  readonly no_rating: boolean;
  readonly birthday: {
    readonly day: number;
    readonly month: number;
    readonly year: number | null;
  } | null;
  readonly gender: 'male' | 'female' | null;
  readonly email: string | null;
  readonly note: string | null;
}

/** المعاينة المقبولة كما يقرأها العامل: الطلب وهويته وصفوفه. */
export interface CustomerImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly requested_at: string | null;
  readonly expires_at: string;
  readonly error_count: number;
  readonly rows: readonly CustomerImportCommitRow[];
}

/**
 * يتحقق أن طلب التثبيت ما زال حيّاً: الطلب بعد انتهاء المعاينة أو بتوقيت ناقص مرفوض.
 *
 * @param preview المعاينة المقبولة كما يقرأها العامل
 * @returns لا شيء؛ الرمي هو النتيجة
 */
export function requireCustomerImportRequestLive(preview: CustomerImportCommitPreview): void {
  const requested = Date.parse(preview.requested_at ?? '');
  const expires = Date.parse(preview.expires_at);
  if (!Number.isFinite(requested) || !Number.isFinite(expires) || requested >= expires)
    throw new CustomerImportCommitError('IMPORT_PREVIEW_EXPIRED');
}

/**
 * حد الزمن الذي قبله الطلب عالق: المسح يفشل ما طلب قبله بدل ما يكرره للأبد.
 *
 * @param now اللحظة المحقونة بالمللي ثانية
 * @returns الحد الذي قبله الطلب عالق
 */
export function customerImportCommitStaleBefore(now: number): number {
  return now - CUSTOMER_IMPORT_STALE_MS;
}
