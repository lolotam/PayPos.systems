/** عمر الطلب المعلق قبل تدخل الاستعادة، وليس مهلة تنفيذ البيع داخل المعاملة. */
export const PACKAGE_SALE_STALE_AFTER_MS = 10 * 60 * 1000;

/** حد صفحات المسح الواحدة: 20 صفحة × 50 مرشحاً، حتى لا يجعل تراكم انقطاع الخدمة الجولة غير محدودة، والباقي يلتقطه مجدول الشركة كل 60 ثانية. */
export const PACKAGE_SALE_RECOVERY_MAX_PAGES = 20;

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
