export const serviceSessionErrors = {
  SESSION_ATTEMPT_NOT_PERSISTED: { message_ar: 'مش ممكن الحفظ بأمان في المتصفح ده لأن التخزين مش متاح. فضّي مساحة أو اخرجي من وضع التصفح الخاص.', message_en: "Can't save safely in this browser — storage is unavailable; free space or leave private mode." },
  SESSION_CUSTOMER_NOT_FOUND: { message_ar: 'العميلة غير موجودة.', message_en: 'Customer not found.' },
  SESSION_SERVICE_NOT_FOUND: { message_ar: 'الخدمة غير موجودة في النشاط.', message_en: 'Service not found in this business.' },
  SESSION_PERFORMER_NOT_ELIGIBLE: { message_ar: 'الموظفة غير مؤهلة لهذا الفرع في يوم الجلسة.', message_en: 'Performer is not eligible at this branch on the session date.' },
  SESSION_PERFORMER_SELF_FORBIDDEN: { message_ar: 'لا يمكنك تسجيل خدمة قمت بها بنفسك.', message_en: 'You cannot record your own performance.' },
  SESSION_PERFORMER_SHARES_INVALID: { message_ar: 'نسب الموظفات غير صحيحة.', message_en: 'Performer shares are invalid.' },
  SESSION_DISCOUNT_INVALID: { message_ar: 'الخصم يجب أن يكون بين صفر والسعر.', message_en: 'Discount must be between zero and the price.' },
  SESSION_DISCOUNT_ABOVE_LIMIT: { message_ar: 'الخصم الفعلي أعلى من حدك. عدّلي هذا البند.', message_en: 'Effective discount exceeds your limit. Edit this line.' },
  SESSION_TIME_IN_FUTURE: { message_ar: 'وقت الجلسة في المستقبل.', message_en: 'Session time is in the future.' },
  SESSION_TIME_TOO_OLD: { message_ar: 'الجلسة أقدم من أول الشهر السابق.', message_en: 'Session predates the first day of the previous month.' },
  SESSION_TIME_INVALID: { message_ar: 'وقت الجلسة أو المنطقة الزمنية غير صحيح.', message_en: 'Invalid session time or timezone.' },
  SESSION_TOTAL_TOO_LARGE: { message_ar: 'إجمالي الزيارة أكبر من الحد المالي المسموح.', message_en: 'Visit total exceeds the supported monetary range.' },
  SESSION_LINE_CAPACITY_EXCEEDED: { message_ar: 'الزيارة لا تقبل أكثر من عشرين بنداً.', message_en: 'A visit cannot contain more than twenty persisted lines.' },
  SESSION_RECORDER_MEMBERSHIP_REQUIRED: { message_ar: 'اختاري عضويتك التي تسجلين الجلسة بها.', message_en: 'Select your recorder membership.' },
} as const;
export type ServiceSessionErrorCode = keyof typeof serviceSessionErrors;
