/**
 * طريقة حساب بند واحد على خدمة: نسبة bps أو مبلغ ثابت بالفلس.
 * المقام المشترك للحساب الدقيق هو 10000.
 */
export interface CommissionCalc {
  readonly kind: 'PCT' | 'FIXED';
  /** value نسبة bps عند PCT، ومبلغ bigint mills عند FIXED؛ ليست وحدات Percentage المشتركة. */
  readonly value: bigint;
}

/**
 * قاعدة عمولة الخدمة التي تستبدل الخطة للبند؛ FOLLOW_PLAN وحدها تستخدم أساسي الخطة وشرائحها.
 * النوع مشترك بين catalog (تخزين القاعدة) وcommissions (تسعير البند)، ومكانه الـ shared kernel
 * عشان ممنوع أي domain يورّد من domain موديول تاني.
 */
export type ServiceCommissionRule =
  CommissionCalc | { readonly kind: 'ZERO' } | { readonly kind: 'FOLLOW_PLAN' };
