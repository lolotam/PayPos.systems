import type { Catalog } from './catalog.js';

// الكتالوج العربي — نفس مفاتيح en.ts بالظبط، والـ type بيوقع الـ build لو مفتاح ناقص أو زيادة.
export const ar: Catalog = {
  errors: {
    VALIDATION_FAILED: 'البيانات المرسلة غير صحيحة',
    BAD_REQUEST: 'الطلب غير صالح',
    UNAUTHENTICATED: 'يجب تسجيل الدخول',
    AUTHENTICATION_FAILED: 'تعذّر تسجيل الدخول بهذه البيانات',
    FORBIDDEN: 'غير مسموح بهذا الإجراء',
    FEATURE_DISABLED: 'هذه الخاصية غير مفعّلة لشركتك',
    PAIRING_CODE_INVALID: 'كود الربط غير صحيح أو انتهت صلاحيته',
    DEVICE_PENDING: 'الجهاز في انتظار موافقة المدير',
    DEVICE_NOT_PENDING: 'لا يوجد جهاز في انتظار الموافقة بهذا المعرّف في هذا الفرع',
    PIN_INVALID: 'الرقم السري غير صحيح',
    PIN_LOCKED: 'الرقم السري مقفول بعد محاولات خاطئة كثيرة، حاول بعد 15 دقيقة',
    NOT_FOUND: 'المسار غير موجود',
    METHOD_NOT_ALLOWED: 'الطريقة غير مسموحة',
    PAYLOAD_TOO_LARGE: 'حجم الطلب كبير جداً',
    URI_TOO_LONG: 'الرابط طويل جداً',
    UNSUPPORTED_MEDIA_TYPE: 'نوع المحتوى غير مدعوم',
    TOO_MANY_REQUESTS: 'طلبات كثيرة، حاول بعد قليل',
    IDEMPOTENCY_KEY_REQUIRED: 'رأس Idempotency-Key مطلوب ويجب أن يكون من 1 إلى 255 حرفاً مرئياً',
    IDEMPOTENCY_KEY_IN_PROGRESS: 'طلب بنفس المفتاح ما زال قيد التنفيذ، أعد المحاولة بعد قليل',
    IDEMPOTENCY_KEY_REUSED: 'تم استخدام مفتاح Idempotency-Key مع طلب مختلف',
    NOT_READY: 'الخدمة غير جاهزة حالياً',
    INTERNAL_ERROR: 'حدث خطأ غير متوقع',
  },
};
