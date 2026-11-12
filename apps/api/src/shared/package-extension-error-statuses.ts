// رموز تمديد الباقة في ملف لوحده عشان errors.ts فوق حد الأسطر بالفعل.
export const PACKAGE_EXTENSION_STATUS = {
  PACKAGE_EXPIRY_STALE: 409,
  PACKAGE_EXTENSION_NOT_LATER: 422,
  PACKAGE_EXTENSION_TOO_LONG: 422,
} as const;
