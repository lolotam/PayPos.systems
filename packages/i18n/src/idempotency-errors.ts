export const idempotencyErrorsAr = {
  IDEMPOTENCY_KEY_REQUIRED: 'رأس Idempotency-Key مطلوب ويجب أن يكون من 1 إلى 255 حرفاً مرئياً',
  IDEMPOTENCY_KEY_IN_PROGRESS: 'طلب بنفس المفتاح ما زال قيد التنفيذ، أعد المحاولة بعد قليل',
  IDEMPOTENCY_KEY_REUSED: 'تم استخدام مفتاح Idempotency-Key مع طلب مختلف',
} as const;

export const idempotencyErrorsEn = {
  IDEMPOTENCY_KEY_REQUIRED:
    'An Idempotency-Key header of 1–255 visible ASCII characters is required',
  IDEMPOTENCY_KEY_IN_PROGRESS:
    'A request with this Idempotency-Key is still in progress — retry shortly',
  IDEMPOTENCY_KEY_REUSED: 'This Idempotency-Key was already used with a different request',
} as const;
