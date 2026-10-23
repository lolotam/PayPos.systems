/** غياب الإعداد المطلوب يمنع صرف نتيجة جزئية للموظفة وفق D-57. */
export type CommissionConfigurationError = 'NO_PLAN' | 'NO_SALARY';

/** أخطاء مسماة للمنشئ والـ API حتى يرفضا نفس التركيبات والقيم غير المسموحة. */
export type CommissionValidationError =
  | 'INVALID_PLAN'
  | 'INVALID_COMBINATION'
  | 'INVALID_CALC'
  | 'INVALID_THRESHOLD'
  | 'MIXED_THRESHOLDS'
  | 'STEPS_NOT_ASCENDING'
  | 'NO_STEPS';

/** نتيجة تحقق صافية لا تحمل نصوص عرض أو استثناءات HTTP. */
export type CommissionValidationResult =
  { readonly ok: true } | { readonly ok: false; readonly code: CommissionValidationError };
