/** طلب محلي قبل تحويل فترة الإجازة إلى UTC؛ لا يحمل هوية يختارها الموظف. */
export type LeaveTerms = {
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';
  note?: string | undefined;
} & (
  | { kind: 'FULL_DAY'; from: string; to: string }
  | { kind: 'PARTIAL'; date: string; start: string; end: string }
);
/** حالة الإجازة تمتد للموافقة القادمة دون توفير قرار في هذا الـ slice. */
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
/** نسخة مستقرة تحفظ المنطقة والفترة الأصلية لكي يسأل الحضور عن لحظة معتمدة لاحقاً. */
export interface LeaveRecord {
  id: string;
  business_id: string;
  branch_id: string;
  employee_id: string;
  kind: 'FULL_DAY' | 'PARTIAL';
  from: string;
  to: string;
  start: string | null;
  end: string | null;
  timezone: string;
  starts_at: string;
  ends_at: string;
  type: LeaveTerms['type'];
  note: string | null;
  status: LeaveStatus;
  requested_by: string;
  requested_at: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  revision: number;
}
/** تاريخ الموظف المقفول؛ حدود ارتباط الفرع مستبعدة في نهايتها مثل PR 9/16. */
export interface LeaveEmployee {
  id: string;
  user_id: string | null;
  hire_date: string;
  contract_end: string | null;
  deleted_at: string | null;
  attachments: { branch_id: string; from: string; to: string | null }[];
}
/** رفض أعمال مسمى دون تسريب بيانات مورد خارج النطاق. */
export class LeaveError extends Error {
  /**
   * يبني رفضاً مسمى دون تفاصيل المورد.
   *
   * @param code رمز رفض الأعمال المترجم عند حد HTTP
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FEATURE_DISABLED'
      | 'LEAVE_PERIOD_INVALID'
      | 'LEAVE_TIME_STEP_INVALID'
      | 'LEAVE_SPAN_TOO_LONG'
      | 'LEAVE_NOTE_REQUIRED'
      | 'LEAVE_LOCAL_TIME_INVALID'
      | 'LEAVE_EMPLOYEE_INELIGIBLE'
      | 'LEAVE_OVERLAP'
      | 'LEAVE_PAST_OWN_FORBIDDEN'
      | 'LEAVE_NOT_PENDING'
      | 'LEAVE_REVISION_CONFLICT'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
    this.name = 'LeaveError';
  }
}
