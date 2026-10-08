export const attendanceCorrectionErrorsEn = {
  ATTENDANCE_CORRECTION_SELF_FORBIDDEN: 'Only the owner may correct their own attendance.',
  ATTENDANCE_SESSION_OPEN:
    'This attendance session is still open. Close it before correcting the times.',
  ATTENDANCE_SESSION_REVISION_CONFLICT: 'The attendance session changed. Reload and try again.',
  ATTENDANCE_CORRECTION_INVALID_TIMES:
    'Those attendance times are not allowed. Clock-out must be after clock-in, within 16 hours, not in the future, and must not overlap another session.',
  ATTENDANCE_CORRECTION_WORKING_DATE:
    'A clock-in correction cannot move the session to another working date.',
};
export const attendanceCorrectionErrorsAr: Record<
  keyof typeof attendanceCorrectionErrorsEn,
  string
> = {
  ATTENDANCE_CORRECTION_SELF_FORBIDDEN: 'لا يمكنك تصحيح حضورك أنت إلا إذا كنت المالك.',
  ATTENDANCE_SESSION_OPEN: 'الجلسة ما زالت مفتوحة. أغلقها أولاً ثم صحّح الوقت.',
  ATTENDANCE_SESSION_REVISION_CONFLICT: 'تغيرت جلسة الحضور. أعد التحميل وحاول مرة أخرى.',
  ATTENDANCE_CORRECTION_INVALID_TIMES:
    'أوقات الحضور غير مقبولة. يجب أن يكون الخروج بعد الدخول، وألا يتجاوز ١٦ ساعة، وألا يكون في المستقبل، وألا يتداخل مع جلسة أخرى.',
  ATTENDANCE_CORRECTION_WORKING_DATE: 'لا يمكن نقل بداية الحضور إلى يوم عمل آخر.',
};
