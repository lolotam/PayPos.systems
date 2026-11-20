/**
 * عمر طلب التثبيت قبل تدخل المسح، وليس مهلة تنفيذ التثبيت داخل المعاملة.
 * الطلب المقبول الذي فقدت وظيفته أو سقط عاملُه بعد استنفاد المحاولات لازم ينتهي بحالة نهائية، ولا يبقى معلقًا بلا نهاية.
 */
export const PACKAGE_IMPORT_COMMIT_STALE_MS = 10 * 60 * 1000;

/** حد صفحات المسح الواحدة: 20 صفحة × 50 مرشحًا؛ ما تبقى يلتقطه مجدول الشركة في الدقيقة التالية. */
export const PACKAGE_IMPORT_RECOVERY_MAX_PAGES = 20;

/**
 * يحسب حد requested_at الشامل للطلبات التي أكملت عشر دقائق منذ القبول لتغلقها الاستعادة.
 * الحد شامل: عبارة التحديث تقارن requested_at <= before، فالطلب الذي قُبل عند الحد بالضبط يدخل في الصفحة.
 *
 * @param now ساعة العامل المحقونة
 * @returns حد requested_at للطلبات العالقة المؤهلة للفشل
 */
export function packageImportCommitStaleBefore(now: Date): Date {
  return new Date(now.getTime() - PACKAGE_IMPORT_COMMIT_STALE_MS);
}

/**
 * يحدد هل أغلقت نافذة العشر دقائق منذ إدخال مهمة التثبيت في الطابور.
 * بعد الإغلاق يصير المسح صاحب القرار على الطلب، فلا تبدأ محاولة مالية جديدة؛ والحد شامل عند العشر دقائق بالضبط.
 *
 * @param enqueuedAtMs لحظة إدخال المهمة في الطابور بالميلي ثانية
 * @param nowMs ساعة العامل المحقونة بالميلي ثانية
 * @returns true لو مرّت عشر دقائق أو أكثر على الإدخال
 */
export function packageImportCommitWindowClosed(enqueuedAtMs: number, nowMs: number): boolean {
  return nowMs - enqueuedAtMs >= PACKAGE_IMPORT_COMMIT_STALE_MS;
}
