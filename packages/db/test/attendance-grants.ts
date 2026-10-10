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
  'attendance_corrections:SELECT',
  'attendance_corrections:INSERT',
  // بند 21b: محاولات الرفض لا تُعدل ولا تُحذف.
  'attendance_device_refusals:SELECT',
  'attendance_device_refusals:INSERT',
  // بند 16b-2: دفتر «مارجعتش من البريك» يُدرج ولا يُعدّل ولا يُحذف.
  'attendance_break_not_returned_notices:SELECT',
  'attendance_break_not_returned_notices:INSERT',
].sort();
