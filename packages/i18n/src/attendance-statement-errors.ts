export const attendanceStatementErrorsEn = {
  ATTENDANCE_STATEMENT_PERIOD_INVALID:
    'Choose a valid period of up to 366 days, ending within the current month.',
  ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND:
    'The employee was not found or has no attendance data in this period.',
  ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND: 'The branch was not found.',
  ATTENDANCE_STATEMENT_RATE_LIMITED: 'Too many statement requests. Try again later.',
  ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID:
    'A shift filter is available only for a branch statement.',
  RENDERER_UNAVAILABLE: 'Document rendering is temporarily unavailable. Try again later.',
  DOCUMENT_NOT_READY: 'The document is not ready yet.',
  DOCUMENT_EXPIRED: 'The document is no longer available. Request a new one.',
};

export const attendanceStatementErrorsAr = {
  ATTENDANCE_STATEMENT_PERIOD_INVALID: 'اختاري فترة صحيحة لحد 366 يوم وتنتهي جوّه الشهر الحالي.',
  ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND:
    'الموظفة مش موجودة أو مفيش ليها بيانات حضور في الفترة دي.',
  ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND: 'الفرع ده مش موجود.',
  ATTENDANCE_STATEMENT_RATE_LIMITED: 'طلبات كشوف كتير، جرّبي بعد شوية.',
  ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID: 'فلتر الشيفت متاح لكشف الفرع بس.',
  RENDERER_UNAVAILABLE: 'تجهيز المستندات مش متاح دلوقتي، جرّبي بعد شوية.',
  DOCUMENT_NOT_READY: 'المستند لسه مش جاهز.',
  DOCUMENT_EXPIRED: 'المستند ده مش متاح دلوقتي، اطلبي واحد جديد.',
};

export const attendanceStatementRenderErrors: Record<
  'STATEMENT_EMPTY',
  { message_ar: string; message_en: string }
> = {
  STATEMENT_EMPTY: {
    message_ar: 'مفيش بيانات حضور في الفترة دي.',
    message_en: 'There is no attendance data in this period.',
  },
};
