// أكواد «إعطاء الدخول» (spec 076 FR-F1-5) في ملف لوحده عشان errors.ts يفضل تحت حد الـ 400 سطر.
// الرفوض الثلاثة بتاعتي المواصفة، وكلها raised by the API only: مفيش أي تفاصيل عن أي حساب آخر.
// كودا الرقم السري المؤقت (PIN_CHANGE_REQUIRED وPIN_EXPIRED) معاهم: هم رفضات الـ API نفسها.
export const STAFF_ACCESS_STATUS = {
  STAFF_ACCESS_PHONE_TAKEN: 409,
  STAFF_ACCESS_ALREADY_GRANTED: 409,
  STAFF_ACCESS_NOT_ALLOWED: 403,
  // AC-ACT-12: منحة أو إلغاء «إعطاء الدخول» قيد التنفيذ يمنع نقل الموظفة لفرع تاني.
  STAFF_ACCESS_PENDING_BRANCH_CHANGE: 409,
  // الرقم السري المؤقت: لازم يتغيّر قبل الدخول، أو مدته خلصت.
  PIN_CHANGE_REQUIRED: 403,
  PIN_EXPIRED: 403,
} as const;
