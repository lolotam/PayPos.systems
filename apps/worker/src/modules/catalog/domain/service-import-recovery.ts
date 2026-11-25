/**
 * عمر طلب التثبيت قبل تدخل المسح، وليس مهلة تنفيذ التثبيت داخل المعاملة.
 * الطلب المقبول الذي فقدت وظيفته أو سقط عاملُه بعد استنفاد المحاولات لازم ينتهي بحالة نهائية، ولا يبقى معلقًا بلا نهاية.
 */
export const SERVICE_IMPORT_COMMIT_STALE_MS = 10 * 60 * 1000;

/** حد صفحات المسح الواحدة: 20 صفحة × 50 مرشحًا؛ ما تبقى يلتقطه مجدول الشركة في الدقيقة التالية. */
export const SERVICE_IMPORT_RECOVERY_MAX_PAGES = 20;

/**
 * يحسب حد requested_at الشامل للطلبات التي أكملت عشر دقائق منذ القبول لتغلقها الاستعادة.
 * الحد شامل: عبارة التحديث تقارن requested_at <= before، فالطلب الذي قُبل عند الحد بالضبط يدخل في الصفحة.
 *
 * @param now ساعة العامل المحقونة
 * @returns حد requested_at للطلبات العالقة المؤهلة للفشل
 */
export function serviceImportCommitStaleBefore(now: Date): Date {
  return new Date(now.getTime() - SERVICE_IMPORT_COMMIT_STALE_MS);
}
