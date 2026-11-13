// رموز استرداد الباقة (spec 058 §6) في ملف لوحدها عشان errors.ts فوق حد الأسطر بالفعل.
export const PACKAGE_REFUND_STATUS = {
  PACKAGE_COMPONENT_NOT_FOUND: 422,
  IMPORTED_REFUND_DISABLED: 422,
  INSUFFICIENT_SLOTS: 422,
  PACKAGE_EXPIRED: 422,
  PACKAGE_REFUND_REASON_INVALID: 422,
} as const;
