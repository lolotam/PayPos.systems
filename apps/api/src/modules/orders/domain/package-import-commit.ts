/** رمز رفض مسمّى لطلب تثبيت الاستيراد؛ يحوّله HTTP إلى الغلاف الموجود دون كشف أي بيانات. */
export type PackageImportCommitErrorCode =
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'IMPORT_PREVIEW_NOT_FOUND'
  | 'IMPORT_PREVIEW_EXPIRED'
  | 'IMPORT_PREVIEW_HAS_ERRORS'
  | 'IMPORT_FILE_NOT_READY'
  | 'IMPORT_COMMIT_FAILED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'TRANSACTION_RETRY_REQUIRED';

/** رفض متوقع بلا بيانات صفوف أو ملف أو أسماء. */
export class PackageImportCommitError extends Error {
  /**
   * يحتفظ بسبب الرفض الآمن الذي يحوله HTTP إلى الغلاف الموجود.
   *
   * @param code سبب الرفض
   */
  constructor(readonly code: PackageImportCommitErrorCode) {
    super(code);
    this.name = 'PackageImportCommitError';
  }
}

/** هوية طلب التثبيت؛ الشركة والمستخدم من الحارس، والمفتاح وبصمته من ترويسة الطلب. */
export interface PackageImportCommitActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly previewId: string;
  readonly key: string;
  readonly fingerprint: string;
}

/** حقائق المعاينة المقفلة اللازمة للقرار فقط؛ لا صفوف ولا هواتف. */
export interface StoredPackageImportCommitPreview {
  readonly id: string;
  readonly business_id: string;
  readonly created_by: string;
  readonly status: 'pending' | 'ready' | 'commit_requested' | 'committed' | 'failed';
  readonly expires_at: string;
  readonly error_count: number;
  readonly has_commit_rows: boolean;
}

/** قرار التثبيت: طلب جديد يغيّر الحالة ويكتب الحدث، أو تكرار لطلب مقبول لا يكتب شيئاً. */
export type PackageImportCommitDecision = 'REQUEST' | 'REPEAT';

/**
 * بيقرر هل المعاينة المقفلة تقبل طلب تثبيت جديداً: الحالة الجاهزة غير المنتهية بلا أخطاء وبمواضع
 * الصفوف المثبتة تُطلب، والحالتان commit_requested و committed تكرار بنفس الرد دون تحديث ولا حدث
 * (ثوابت المحفّز 0215 لا تسمح بتحويل ثانٍ)، وغير ذلك رفض مسمّى. المقارنة بحروف صغيرة لأن المعرفات نصوص.
 *
 * @param preview المعاينة المقفلة بعد التحقق من ملكيتها
 * @param now لحظة الطلب المحقونة من الساعة
 * @returns REQUEST أو REPEAT
 */
export function decidePackageImportCommit(
  preview: StoredPackageImportCommitPreview,
  now: Date,
): PackageImportCommitDecision {
  if (preview.status === 'commit_requested' || preview.status === 'committed') return 'REPEAT';
  if (preview.status === 'pending') throw new PackageImportCommitError('IMPORT_FILE_NOT_READY');
  if (preview.status === 'failed') throw new PackageImportCommitError('IMPORT_COMMIT_FAILED');
  if (now.getTime() >= new Date(preview.expires_at).getTime())
    throw new PackageImportCommitError('IMPORT_PREVIEW_EXPIRED');
  if (preview.error_count > 0) throw new PackageImportCommitError('IMPORT_PREVIEW_HAS_ERRORS');
  // معاينة بلا مواضع صفوف ثابتة سابقة لـ 47-2b: لا تُثبَّت، وتُعاد معاينتها (PP-134).
  if (!preview.has_commit_rows) throw new PackageImportCommitError('IMPORT_COMMIT_FAILED');
  return 'REQUEST';
}

/**
 * بيتحقق إن المعاينة تخص النشاط وصاحب الطلب قبل أي قرار؛ غير ذلك لا يُميَّز عن المجهول.
 *
 * @param preview المعاينة المقروءة أو null
 * @param actor هوية الطلب المتحقق منها
 * @returns لا شيء عند الملكية الصحيحة
 */
export function requireOwnedPackageImportPreview(
  preview: StoredPackageImportCommitPreview | null,
  actor: Pick<PackageImportCommitActor, 'businessId' | 'userId'>,
): asserts preview is StoredPackageImportCommitPreview {
  if (
    preview === null ||
    preview.business_id.toLowerCase() !== actor.businessId.toLowerCase() ||
    preview.created_by.toLowerCase() !== actor.userId.toLowerCase()
  )
    throw new PackageImportCommitError('IMPORT_PREVIEW_NOT_FOUND');
}
