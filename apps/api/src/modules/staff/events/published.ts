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
