/** يصدر عند إنشاء أو استبدال راتب تاريخ واحد داخل معاملة الموظف، وتستخدم العمولة النسخة لرفض الأحداث الأقدم. */
export interface SalaryChanged {
  employee_id: string;
  effective_from: string;
  amount: string;
  revision: number;
}

/** الحدث يثبت النسخة المعتمدة بعد commit دون مادة الاعتماد أو تحدياته. */
export interface EmployeePasskeyBound {
  readonly employee_id: string;
  readonly binding_id: string;
  readonly revision: number;
  readonly bound_at: string;
}

/** يصدر بعد فتح جلسة الحضور داخل نفس معاملة State دون أي تأثير على العمولة. */
export interface AttendanceClockedIn {
  readonly session_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
}
/** يصدر عند القفل الطبيعي مع إبقاء تاريخ بداية الحضور الليلي. */
export type AttendanceClockedOut = AttendanceClockedIn;
/** يصدر عند اكتشاف حد ١٦ ساعة، منفصلاً عن حركة الفتح الجديدة. */
export type AttendanceMissedOut = AttendanceClockedIn;
