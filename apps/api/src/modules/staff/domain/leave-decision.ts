import { LeaveError, type LeaveRecord } from './leave-types.ts';

/** قيمة قرار مستقلة عن HTTP؛ لا يختار العميل فاعله أو وقته. */
export interface LeaveDecision {
  decision: 'APPROVED' | 'REJECTED';
  expected_revision: number;
  reason?: string | undefined;
}
/** نسخة فترة أخرى تستخدم فقط لكشف موافقة متداخلة. */
export type ApprovalPeriod = Pick<LeaveRecord, 'id' | 'starts_at' | 'ends_at' | 'status'>;

/**
 * يحصر السبب في نص قصير مقصوص؛ الرفض والسحب لا يقبلان سبباً فارغاً.
 *
 * @param reason النص الاختياري
 * @param required هل العملية تحتاج سبباً
 * @returns السبب المقصوص أو null
 */
export function leaveDecisionReason(reason: string | undefined, required: boolean): string | null {
  const value = reason?.trim();
  if ((required && !value) || (reason !== undefined && (!value || value.length > 500)))
    throw new LeaveError('LEAVE_REASON_REQUIRED');
  return value ?? null;
}

/**
 * يمنع القرار الذاتي عبر كل العضويات؛ رابط المستخدم العالمي هو هوية الموظف.
 *
 * @param employeeUserId رابط الموظف المقفول
 * @param actorUserId الفاعل الحقيقي
 * @returns لا قيمة؛ يرفض تطابق المستخدمين
 */
export function validateLeaveDecider(employeeUserId: string | null, actorUserId: string): void {
  if (employeeUserId === actorUserId) throw new LeaveError('LEAVE_SELF_DECISION_FORBIDDEN');
}

/**
 * يثبت قراراً واحداً على نسخة معلقة ويحفظ سبباً مقصوصاً دون إعادة تفسير الفترة.
 *
 * @param before النسخة المقفولة
 * @param employeeUserId رابط الموظف الذي يمنع القرار الذاتي
 * @param actorUserId صاحب القرار
 * @param input القرار والنسخة والسبب
 * @param now اللحظة المشتركة بعد الأقفال
 * @param others الفترات المقروءة تحت قفل الموظف
 * @returns نسخة قرار جديدة
 */
export function decidePendingLeave(
  before: LeaveRecord,
  employeeUserId: string | null,
  actorUserId: string,
  input: LeaveDecision,
  now: Date,
  others: readonly ApprovalPeriod[],
): LeaveRecord {
  validateLeaveDecider(employeeUserId, actorUserId);
  if (before.status !== 'PENDING') throw new LeaveError('LEAVE_NOT_PENDING');
  if (before.revision !== input.expected_revision || before.revision >= 2147483647)
    throw new LeaveError('LEAVE_REVISION_CONFLICT');
  const reason = leaveDecisionReason(input.reason, input.decision === 'REJECTED');
  // قرار المالك 2026-10-04 (DL-Q1، الخيار الموصى به): الموافقة المتداخلة ترفض؛ الفترات المتجاورة مسموحة.
  if (
    input.decision === 'APPROVED' &&
    others.some(
      (r) =>
        r.id !== before.id &&
        r.status === 'APPROVED' &&
        r.starts_at < before.ends_at &&
        r.ends_at > before.starts_at,
    )
  )
    throw new LeaveError('LEAVE_APPROVED_OVERLAP');
  return {
    ...before,
    status: input.decision,
    decided_by: actorUserId,
    decided_at: now.toISOString(),
    decision_reason: reason,
    rejection_reason: input.decision === 'REJECTED' ? reason : null,
    revision: before.revision + 1,
  };
}

/**
 * يسحب موافقة قبل بدايتها فقط مع إبقاء القرار الأصلي كحقيقة تاريخية.
 *
 * @param before النسخة المعتمدة المقفولة
 * @param employeeUserId رابط الموظف لمنع السحب الذاتي
 * @param actorUserId صاحب السحب
 * @param input النسخة والسبب الإلزامي
 * @param input.expected_revision النسخة المتوقع تعديلها
 * @param input.reason سبب السحب
 * @param now اللحظة المشتركة
 * @returns نسخة CANCELLED تحمل فاعل وتوقيت سحب مستقلين
 */
export function revokeApprovedLeave(
  before: LeaveRecord,
  employeeUserId: string | null,
  actorUserId: string,
  input: { expected_revision: number; reason: string },
  now: Date,
): LeaveRecord {
  validateLeaveDecider(employeeUserId, actorUserId);
  if (before.status !== 'APPROVED') throw new LeaveError('LEAVE_NOT_APPROVED');
  if (before.revision !== input.expected_revision || before.revision >= 2147483647)
    throw new LeaveError('LEAVE_REVISION_CONFLICT');
  // قرار المالك 2026-10-04 (DL-Q2، الخيار الموصى به): السحب حتى ما قبل البداية فقط؛ تصحيح الحضور بعد البداية في PR 26.
  if (now.getTime() >= Date.parse(before.starts_at)) throw new LeaveError('LEAVE_ALREADY_STARTED');
  const reason = leaveDecisionReason(input.reason, true);
  return {
    ...before,
    status: 'CANCELLED',
    revoked_by: actorUserId,
    revoked_at: now.toISOString(),
    revocation_reason: reason,
    revision: before.revision + 1,
  };
}
