// أكواد «إعطاء الدخول» (spec 076 FR-F1-5) في ملف لوحده عشان errors.ts يفضل تحت حد الـ 400 سطر.
// الرفوض الثلاثة بتاعتي المواصفة، وكلها raised by the API only: مفيش أي تفاصيل عن أي حساب آخر.
export const STAFF_ACCESS_STATUS = {
  STAFF_ACCESS_PHONE_TAKEN: 409,
  STAFF_ACCESS_ALREADY_GRANTED: 409,
  STAFF_ACCESS_NOT_ALLOWED: 403,
} as const;
