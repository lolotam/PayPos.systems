export const attendanceExceptionErrorsEn = {
  ATTENDANCE_EXCEPTION_SELF_FORBIDDEN:
    'You cannot resolve or reopen an exception on your own attendance.',
  ATTENDANCE_EXCEPTION_NOT_MANUAL:
    'This attendance exception is resolved by the system, not by a manager.',
  ATTENDANCE_EXCEPTION_REVISION_CONFLICT:
    'The attendance exception changed. Reload and try again.',
};
export const attendanceExceptionErrorsAr: Record<keyof typeof attendanceExceptionErrorsEn, string> =
  {
    ATTENDANCE_EXCEPTION_SELF_FORBIDDEN: 'لا يمكنك إغلاق أو إعادة فتح استثناء على حضورك أنت.',
    ATTENDANCE_EXCEPTION_NOT_MANUAL: 'هذا الاستثناء يغلقه النظام، وليس المدير.',
    ATTENDANCE_EXCEPTION_REVISION_CONFLICT: 'تغير استثناء الحضور. أعد التحميل وحاول مرة أخرى.',
  };
