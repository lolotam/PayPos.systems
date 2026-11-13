import { PACKAGE_EXTENSION_STATUS } from './package-extension-error-statuses.ts';

// رموز استرداد الباقة (spec 058 §6) في ملف لوحدها عشان errors.ts فوق حد الأسطر بالفعل.
export const PACKAGE_REFUND_STATUS = {
  PACKAGE_COMPONENT_NOT_FOUND: 422,
  IMPORTED_REFUND_DISABLED: 422,
  INSUFFICIENT_SLOTS: 422,
  PACKAGE_EXPIRED: 422,
  PACKAGE_REFUND_REASON_INVALID: 422,
} as const;

// تمديد الباقة واستردادها مع بعض: errors.ts بيستورد الاتنين بسطر واحد عشان يفضل تحت حد الأسطر.
export const PACKAGE_CHANGE_STATUS = {
  ...PACKAGE_EXTENSION_STATUS,
  ...PACKAGE_REFUND_STATUS,
} as const;
