// صلاحيات PR 22 المقصودة؛ لا حذف للحضور ولا إعادة كتابة لسياق التحدي.
export const ATTENDANCE_TABLE_GRANTS = [
  'attendance_states:SELECT',
  'attendance_states:INSERT',
  'attendance_states:UPDATE',
  'attendance_sessions:SELECT',
  'attendance_sessions:INSERT',
  'attendance_sessions:UPDATE',
  'attendance_exceptions:SELECT',
  'attendance_exceptions:INSERT',
  'attendance_exceptions:UPDATE',
  'attendance_clock_challenges:SELECT',
  'attendance_clock_challenges:INSERT',
].sort();
