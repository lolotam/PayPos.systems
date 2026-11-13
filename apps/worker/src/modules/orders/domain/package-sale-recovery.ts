/** عمر الطلب المعلق قبل تدخل الاستعادة، وليس مهلة تنفيذ البيع داخل المعاملة. */
export const PACKAGE_SALE_STALE_AFTER_MS = 10 * 60 * 1000;

/**
 * يحدد الطلبات التي أكملت عشر دقائق pending منذ القبول لتغلقها الاستعادة (SA-09b).
 * التأخر قد ينتج عن وظيفة مفقودة أو تعذر تثبيت الفشل، لذلك لا يبقى الطلب معلقاً بلا نهاية.
 *
 * @param now ساعة العامل المحقونة
 * @returns حد recorded_at الشامل للطلبات العالقة
 */
export function packageSaleStaleBefore(now: Date): Date {
  return new Date(now.getTime() - PACKAGE_SALE_STALE_AFTER_MS);
}
