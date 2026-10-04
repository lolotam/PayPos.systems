import { LeaveError, type LeaveEmployee, type LeaveRecord } from './leave-types.ts';
/**
 * يتأكد أن الفترة كلها داخل خدمة الموظف وارتباطه بالفرع، فلا تكفي أهلية يوم الطلب وحده.
 *
 * @param employee التاريخ المقفول
 * @param branchId الفرع المختار والمسموح
 * @param period أول وآخر يوم شاملين
 * @param period.from أول يوم
 * @param period.to آخر يوم
 * @returns لا قيمة؛ رفض عند خروج الفترة من الخدمة أو ارتباط الفرع
 */
export function validateLeaveEmployee(
  employee: LeaveEmployee,
  branchId: string,
  period: { from: string; to: string },
): void {
  const intervals = employee.attachments
    .filter((a) => a.branch_id === branchId)
    .sort((a, b) => a.from.localeCompare(b.from));
  let coveredThrough = period.from;
  for (const interval of intervals) {
    if (interval.from > coveredThrough) break;
    if (interval.to === null) {
      coveredThrough = '9999-12-31';
      break;
    }
    if (interval.to > coveredThrough) coveredThrough = interval.to;
  }
  if (
    employee.deleted_at !== null ||
    employee.hire_date > period.from ||
    (employee.contract_end !== null && employee.contract_end < period.to) ||
    coveredThrough <= period.to
  )
    throw new LeaveError('LEAVE_EMPLOYEE_INELIGIBLE');
}
/**
 * يلغي النسخة المعلقة فقط؛ الذات لا تلغي طلباً سجله فاعل آخر ومدير النطاق يقدر يلغي.
 *
 * @param before النسخة المقفولة
 * @param userId الفاعل الحقيقي
 * @param own هل التحقق ذاتي
 * @param revision النسخة المتوقعة
 * @param now الوقت المحقون
 * @returns نسخة CANCELLED جديدة دون تعديل المصدر
 */
export function cancelPendingLeave(
  before: LeaveRecord,
  userId: string,
  own: boolean,
  revision: number,
  now: Date,
): LeaveRecord {
  if (own && before.requested_by !== userId) throw new LeaveError('NOT_FOUND');
  if (before.status !== 'PENDING') throw new LeaveError('LEAVE_NOT_PENDING');
  if (before.revision !== revision || before.revision >= 2147483647)
    throw new LeaveError('LEAVE_REVISION_CONFLICT');
  return {
    ...before,
    status: 'CANCELLED',
    cancelled_by: userId,
    cancelled_at: now.toISOString(),
    revision: before.revision + 1,
  };
}
/**
 * يحصر لقطة التدقيق والحدث في الهوية والفترة والحالة دون نسخ ملاحظة صحية حرة.
 *
 * @param record النسخة المحفوظة
 * @returns لقطة آمنة للتدقيق والأحداث
 */
export function leaveSnapshot(record: LeaveRecord) {
  const {
    note: _note,
    rejection_reason: _reason,
    decision_reason: _decision,
    revocation_reason: _revocation,
    ...snapshot
  } = record;
  void _note;
  void _reason;
  void _decision;
  void _revocation;
  return snapshot;
}
