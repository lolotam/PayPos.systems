/** الحد الثابت لاستعادة الطلب العالق، وليس صلاحية معاينة الـ 24 ساعة. */
export const IMPORT_COMMIT_STALE_MS = 10 * 60 * 1000;

/**
 * يحدد آخر وقت طلب يدخل في معالجة التعليق؛ الطلب الأحدث ينتظر وظيفته.
 *
 * @param now ساعة العامل المحقونة
 * @returns حد الطلبات العالقة شاملاً المساواة
 */
export function importCommitStaleBefore(now: Date): Date {
  return new Date(now.getTime() - IMPORT_COMMIT_STALE_MS);
}
