/** قاعدة كتالوج الخدمة وفق SPEC §4 و§5؛ لا تسعّر العمولة ولا تعتمد على نطاق commissions. */
export type ServiceCommissionRule =
  | { readonly kind: 'FOLLOW_PLAN' }
  | { readonly kind: 'ZERO' }
  | { readonly kind: 'PCT'; readonly value: bigint }
  | { readonly kind: 'FIXED'; readonly value: bigint };
