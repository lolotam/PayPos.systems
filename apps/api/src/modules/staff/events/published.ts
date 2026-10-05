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
  revoked_by: string | null;
  revoked_at: string | null;
  revision: number;
}
/** يصدر بعد إلغاء طلب معلق مع الفاعل والنسخة الجديدة داخل نفس معاملة الإلغاء. */
export type LeaveCancelled = LeaveRequested;
/** يصدر عند انتقال PENDING إلى APPROVED مع الفاعل والنسخة دون سبب حر في الحدث. */
export type LeaveApproved = LeaveRequested;
/** يصدر عند رفض PENDING؛ السبب محفوظ في الطلب ومتاح للموظف وليس حمولة الحدث. */
export type LeaveRejected = LeaveRequested;
/** يصدر عند سحب موافقة قبل البداية؛ يحتفظ بهوية وتوقيت الموافقة الأصلية والسحب. */
export type LeaveRevoked = LeaveRequested;

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
/** يصدر عند فك المدير للربط وإبطال النسخة مع التدقيق في نفس commit، دون الاعتماد أو السبب الحر. */
export interface EmployeePasskeyUnbound {
  readonly employee_id: string;
  readonly binding_id: string;
  readonly revision: number;
  readonly unbound_at: string;
}

/** يصدر عند تسجيل وثيقة موظف واستبدال الحالية من نوعها في نفس commit، دون مفتاح الملف أو محتواه. */
export interface EmployeeDocumentRecorded {
  readonly document_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly type_code: string;
  readonly expires_on: string | null;
  readonly replaced_document_id: string | null;
  readonly recorded_at: string;
}

/** يصدر لكل موظف أنشأه استيراد ناجح داخل نفس معاملة الالتزام، بلا أي حقل مالي أو اعتماد. */
export interface EmployeeImported {
  readonly employee_id: string;
  readonly business_id: string;
  readonly primary_branch_id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly role_code: string;
  readonly hire_date: string;
  readonly contract_end: string | null;
  readonly created_at: string;
}

/** يصدر مرة واحدة بعد نجاح استيراد، ويلخّص المعاينة والموظفين المنشأين دون صفوفها. */
export interface ImportCommitted {
  readonly preview_id: string;
  readonly business_id: string;
  readonly entity: string;
  readonly created_count: number;
  readonly employee_ids: readonly string[];
  readonly committed_at: string;
}
/** طلب إنشاء موظفي معاينة واحدة؛ الشركة في غلاف outbox، بلا أسماء أو بيانات موظفين. */
export interface EmployeeImportCommitRequested {
  readonly preview_id: string;
}
