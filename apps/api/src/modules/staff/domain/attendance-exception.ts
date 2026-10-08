/** صف استثناء الحضور كما يُقفل ويُعاد؛ السبب المخزن يتبع العمود لا نص الطلب. */
export interface AttendanceExceptionRecord {
  id: string;
  session_id: string;
  employee_id: string;
  branch_id: string;
  kind: 'NONE' | 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT';
  status: 'OPEN' | 'RESOLVED';
  resolution: 'CLOSED_LATE' | 'MISSED_OUT' | 'ACKNOWLEDGED' | 'CARD_SCAN' | null;
  resolved_by: string | null;
  resolved_at: string | null;
  reason: string | null;
  raised_at: string;
  revision: number;
}
/** طلب المدير: النسخة التي قرأها والسبب الإلزامي قبل القص. */
export interface AttendanceExceptionDecision {
  revision: number;
  reason: string;
}
/** نتيجة الدالة النقية: الصف الجديد وسبب هذا القرار للتدقيق. */
export interface AttendanceExceptionChange {
  record: AttendanceExceptionRecord;
  decisionReason: string;
}
/** رفض آمن بلا تفاصيل عن موظف أو فرع خارج النطاق. */
export class AttendanceExceptionError extends Error {
  /**
   * يحتفظ بالرمز فقط.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'VALIDATION_FAILED'
      | 'ATTENDANCE_EXCEPTION_SELF_FORBIDDEN'
      | 'ATTENDANCE_EXCEPTION_NOT_MANUAL'
      | 'ATTENDANCE_EXCEPTION_REVISION_CONFLICT'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}

/**
 * يقص السبب ويفرض طوله؛ الإغلاق وإعادة الفتح كلاهما يحتاجان سبباً.
 *
 * @param reason النص كما وصل
 * @returns السبب المقصوص
 */
export function attendanceExceptionReason(reason: string): string {
  const value = reason.trim();
  // قرار المالك 2026-10-08 (RE-Q2): السبب إلزامي من ١ إلى ٥٠٠ حرفاً بعد القص.
  if (value.length < 1 || value.length > 500)
    throw new AttendanceExceptionError('VALIDATION_FAILED');
  return value;
}

/**
 * يمنع المدير من البت في استثناء حضوره حتى لو ملك صلاحية الفرع.
 *
 * @param employeeUserId رابط الموظف المقفول، أو null إن لم يُربط بحساب
 * @param actorUserId الفاعل الحقيقي
 * @returns لا قيمة؛ يرفض تطابق المستخدمين
 */
export function assertAttendanceExceptionDecider(
  employeeUserId: string | null,
  actorUserId: string,
): void {
  // قرار المالك 2026-10-08 (RE-Q3): لا أحد يغلق استثناء حضوره، والمالك ليس استثناء.
  if (employeeUserId === actorUserId)
    throw new AttendanceExceptionError('ATTENDANCE_EXCEPTION_SELF_FORBIDDEN');
}

/**
 * يحصر القرار اليدوي في غياب الموقع والخروج عن النطاق.
 *
 * @param kind نوع الاستثناء المقفول
 * @returns لا قيمة؛ يرفض اشتباه الخروج الذي يغلقه النظام
 */
export function assertAttendanceExceptionManual(
  kind: AttendanceExceptionRecord['kind'],
): void {
  // قرار المالك 2026-10-08 (RE-Q1): SUSPECTED_MISSED_OUT يغلقه المسح التالي أو حد ١٦ ساعة.
  if (kind === 'SUSPECTED_MISSED_OUT')
    throw new AttendanceExceptionError('ATTENDANCE_EXCEPTION_NOT_MANUAL');
}

/**
 * يغلق استثناءً مفتوحاً بإقرار المدير ويزيد النسخة.
 *
 * @param before الصف المقفول
 * @param employeeUserId رابط الموظف لمنع القرار الذاتي
 * @param actorUserId صاحب الإغلاق
 * @param input النسخة والسبب
 * @param now اللحظة المشتركة بعد الأقفال
 * @returns الصف المغلق وسبب هذا القرار
 */
export function resolveAttendanceException(
  before: AttendanceExceptionRecord,
  employeeUserId: string | null,
  actorUserId: string,
  input: AttendanceExceptionDecision,
  now: Date,
): AttendanceExceptionChange {
  const decisionReason = prepare(before, employeeUserId, actorUserId, input, 'OPEN');
  return {
    decisionReason,
    record: {
      ...before,
      status: 'RESOLVED',
      resolution: 'ACKNOWLEDGED',
      resolved_by: actorUserId,
      resolved_at: now.toISOString(),
      reason: decisionReason,
      revision: before.revision + 1,
    },
  };
}

/**
 * يعيد استثناءً مغلقاً يدوياً إلى المفتوح ويمسح حقول الإغلاق من الصف.
 *
 * @param before الصف المقفول
 * @param employeeUserId رابط الموظف لمنع القرار الذاتي
 * @param actorUserId صاحب إعادة الفتح
 * @param input النسخة والسبب
 * @param now اللحظة المشتركة بعد الأقفال
 * @returns الصف المفتوح وسبب إعادة الفتح
 */
export function reopenAttendanceException(
  before: AttendanceExceptionRecord,
  employeeUserId: string | null,
  actorUserId: string,
  input: AttendanceExceptionDecision,
  now: Date,
): AttendanceExceptionChange {
  const decisionReason = prepare(before, employeeUserId, actorUserId, input, 'RESOLVED');
  void now;
  // قرار المالك 2026-10-08 (RE-Q6): إعادة الفتح تفرغ الإغلاق؛ السبب السابق يبقى في تدقيق before.
  return {
    decisionReason,
    record: {
      ...before,
      status: 'OPEN',
      resolution: null,
      resolved_by: null,
      resolved_at: null,
      reason: null,
      revision: before.revision + 1,
    },
  };
}

/**
 * لقطة الصف الستة حقول التي يحفظها التدقيق قبل التغيير وبعده.
 *
 * @param row الصف
 * @returns الحالة والإغلاق والسبب والنسخة كما هي على الصف
 */
export function attendanceExceptionSnapshot(row: AttendanceExceptionRecord) {
  return {
    status: row.status,
    resolution: row.resolution,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    reason: row.reason,
    revision: row.revision,
  };
}

/**
 * يبني قبل/بعد التدقيق. سبب هذا القرار يُحفظ مع اللقطة لأن إعادة الفتح تفرغ عمود السبب.
 *
 * @param before الصف قبل القرار
 * @param after الصف بعده
 * @param decisionReason السبب المقصوص لهذا القرار
 * @returns اللقطتان؛ after.decision_reason هو سبب الطلب حتى عندما يصبح عمود السبب فارغاً
 */
export function attendanceExceptionAudit(
  before: AttendanceExceptionRecord,
  after: AttendanceExceptionRecord,
  decisionReason: string,
) {
  return {
    before: attendanceExceptionSnapshot(before),
    after: { ...attendanceExceptionSnapshot(after), decision_reason: decisionReason },
  };
}

function prepare(
  before: AttendanceExceptionRecord,
  employeeUserId: string | null,
  actorUserId: string,
  input: AttendanceExceptionDecision,
  requiredStatus: AttendanceExceptionRecord['status'],
): string {
  // الذات قبل النوع: من يجتمع عليه المنعان يُرفض بـ SELF لا بـ NOT_MANUAL.
  assertAttendanceExceptionDecider(employeeUserId, actorUserId);
  // النوع قبل النسخة: اشتباه بنسخة قديمة يبقى NOT_MANUAL لا تعارضاً.
  assertAttendanceExceptionManual(before.kind);
  if (
    before.status !== requiredStatus ||
    before.revision !== input.revision ||
    before.revision >= 2147483647
  )
    throw new AttendanceExceptionError('ATTENDANCE_EXCEPTION_REVISION_CONFLICT');
  return attendanceExceptionReason(input.reason);
}
