/** يصدر عند إنشاء أو استبدال راتب تاريخ واحد داخل معاملة الموظف، وتستخدم العمولة النسخة لرفض الأحداث الأقدم. */
export interface SalaryChanged {
  employee_id: string;
  effective_from: string;
  amount: string;
  revision: number;
}
/** يصدر بعد إنشاء طلب PENDING، داخل معاملة الطلب فقط دون تفعيل رصيد أو اعتماد. */
export interface LeaveRequested {
  id: string;
  employee_id: string;
  business_id: string;
  branch_id: string;
  kind: 'FULL_DAY' | 'PARTIAL';
  from: string;
  to: string;
  start: string | null;
  end: string | null;
  timezone: string;
  starts_at: string;
  ends_at: string;
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requested_by: string;
  requested_at: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  revision: number;
}
/** يصدر بعد إلغاء طلب معلق مع الفاعل والنسخة الجديدة داخل نفس معاملة الإلغاء. */
export type LeaveCancelled = LeaveRequested;

/** الحدث يثبت النسخة المعتمدة بعد commit دون مادة الاعتماد أو تحدياته. */
export interface EmployeePasskeyBound {
  readonly employee_id: string;
  readonly binding_id: string;
  readonly revision: number;
  readonly bound_at: string;
}
