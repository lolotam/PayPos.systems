import { attendanceLateMinutes, attendanceWorkingDate } from './clock-attendance.ts';

/** جلسة مقفولة قبل التصحيح. حقائق المسح لا تدخل القرار. */
export interface AttendanceCorrectionSession {
  id: string;
  employee_id: string;
  branch_id: string;
  working_date: string;
  timezone: string;
  clock_in: string;
  clock_out: string | null;
  status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  closed_by: 'EMPLOYEE' | 'MISSED_OUT' | null;
  late_minutes: number;
  revision: number;
  voided_at: string | null;
  scheduled_start: string | null;
}
/** جلسة أخرى للموظف نفسه؛ المفتوحة بلا خروج تتداخل مع أي فترة تلامسها من الداخل. */
export interface AttendanceCorrectionNeighbour {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  clock_in: string;
  clock_out: string | null;
}
/** الأوقات المطلوبة كما وصلت بعد التحقق من الشكل، والسبب قبل القص. */
export interface AttendanceCorrectionRequest {
  revision: number;
  clock_in?: string | undefined;
  clock_out?: string | undefined;
  reason: string;
}
/** سياق القرار بعد الأقفال: الآن والجلسات المجاورة وهل الفاعل هو الموظف وهل هو المالك. */
export interface AttendanceCorrectionContext {
  now: Date;
  neighbours: readonly AttendanceCorrectionNeighbour[];
  actorIsEmployee: boolean;
  actorIsOwner: boolean;
}
/** صف واحد لكل حقل تغيّر. المعرّفات تُمنح عند الحفظ لا هنا. */
export interface PlannedAttendanceCorrection {
  field: 'CLOCK_IN' | 'CLOCK_OUT';
  before: string;
  after: string;
  reason: string;
}
/** القيم الجديدة للجلسة وصفوف التصحيح، بلا أثر على الحالة أو مصدر الإغلاق. */
export interface AttendanceCorrectionPlan {
  clock_in: string;
  clock_out: string;
  late_minutes: number;
  revision: number;
  status: 'CLOSED' | 'MISSED_OUT';
  closed_by: 'EMPLOYEE' | 'MISSED_OUT';
  working_date: string;
  corrections: readonly PlannedAttendanceCorrection[];
}
/** رفض بلا تفاصيل عن موظف أو فرع خارج النطاق. */
export class AttendanceCorrectionError extends Error {
  /**
   * يحتفظ بالرمز فقط.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'VALIDATION_FAILED'
      | 'ATTENDANCE_CORRECTION_SELF_FORBIDDEN'
      | 'ATTENDANCE_SESSION_OPEN'
      | 'ATTENDANCE_SESSION_VOIDED'
      | 'ATTENDANCE_SESSION_REVISION_CONFLICT'
      | 'ATTENDANCE_CORRECTION_INVALID_TIMES'
      | 'ATTENDANCE_CORRECTION_WORKING_DATE'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}

// قرار المالك 2026-10-08 (CA-Q8): الحد ١٦ ساعة شامل، والخروج بعد الدخول حصراً.
const SIXTEEN_HOURS_MS = 16 * 60 * 60 * 1000;
const instant = (value: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AttendanceCorrectionError('VALIDATION_FAILED');
  return parsed;
};

/**
 * يقص السبب ويفرض طوله قبل أي قرار على الجلسة.
 *
 * @param reason النص كما وصل
 * @returns السبب المقصوص
 */
export function attendanceCorrectionReason(reason: string): string {
  const value = reason.trim();
  // قرار المالك 2026-10-08 (CA-Q4): السبب إلزامي من ١ إلى ٥٠٠ حرفاً بعد القص.
  if (value.length < 1 || value.length > 500)
    throw new AttendanceCorrectionError('VALIDATION_FAILED');
  return value;
}

/**
 * يقرر تصحيح الدخول و/أو الخروج لجلسة مغلقة أو فائتة؛ رفض تصحيح النفس ثم الإلغاء والحالة والنسخة يسبق رفض الطلب بلا تغيير.
 *
 * @param session الجلسة المقفولة
 * @param request النسخة والأوقات والسبب
 * @param context الآن والجلسات المجاورة وهوية الفاعل تجاه الموظف
 * @returns القيم الجديدة وصفوف التصحيح
 */
export function planAttendanceCorrection(
  session: AttendanceCorrectionSession,
  request: AttendanceCorrectionRequest,
  context: AttendanceCorrectionContext,
): AttendanceCorrectionPlan {
  const reason = attendanceCorrectionReason(request.reason);
  if (request.clock_in === undefined && request.clock_out === undefined)
    throw new AttendanceCorrectionError('VALIDATION_FAILED');
  const clockIn =
    request.clock_in === undefined ? instant(session.clock_in) : instant(request.clock_in);
  const clockOut =
    request.clock_out === undefined
      ? session.clock_out === null
        ? null
        : instant(session.clock_out)
      : instant(request.clock_out);
  // قرار المالك 2026-10-08 (CA-Q2): المالك وحده يصحح حضوره. غير الموظف لا تمسّه القاعدة.
  if (context.actorIsEmployee && !context.actorIsOwner)
    throw new AttendanceCorrectionError('ATTENDANCE_CORRECTION_SELF_FORBIDDEN');
  if (session.voided_at !== null) throw new AttendanceCorrectionError('ATTENDANCE_SESSION_VOIDED');
  // قرار المالك 2026-10-08 (CA-Q5): المفتوحة تُغلق بالمسح أو بمهمة الخروج الفائت، لا بالتصحيح.
  if (session.status === 'OPEN') throw new AttendanceCorrectionError('ATTENDANCE_SESSION_OPEN');
  if (session.revision !== request.revision || session.revision >= 2147483647)
    throw new AttendanceCorrectionError('ATTENDANCE_SESSION_REVISION_CONFLICT');
  if (sameClock(session, clockIn, clockOut))
    throw new AttendanceCorrectionError('VALIDATION_FAILED');
  if (clockOut === null || session.closed_by === null)
    throw new AttendanceCorrectionError('ATTENDANCE_SESSION_OPEN');
  assertTimes(clockIn, clockOut, context.now, session.id, context.neighbours);
  const clockInChanged = clockIn.getTime() !== instant(session.clock_in).getTime();
  // قرار المالك 2026-10-08 (CA-Q11): يوم العمل هو يوم الدخول المخزّن. عبور منتصف الليل للخروج مسموح.
  if (clockInChanged && attendanceWorkingDate(clockIn, session.timezone) !== session.working_date)
    throw new AttendanceCorrectionError('ATTENDANCE_CORRECTION_WORKING_DATE');
  return buildPlan(session, clockIn, clockOut, session.closed_by, reason, clockInChanged);
}

function sameClock(
  session: AttendanceCorrectionSession,
  clockIn: Date,
  clockOut: Date | null,
): boolean {
  const inSame = clockIn.getTime() === instant(session.clock_in).getTime();
  const outSame =
    session.clock_out === null
      ? clockOut === null
      : clockOut !== null && clockOut.getTime() === instant(session.clock_out).getTime();
  return inSame && outSame;
}

function assertTimes(
  clockIn: Date,
  clockOut: Date,
  now: Date,
  sessionId: string,
  neighbours: readonly AttendanceCorrectionNeighbour[],
): void {
  const start = clockIn.getTime();
  const end = clockOut.getTime();
  // الترتيب ثم المستقبل ثم المدة ثم التداخل: أول مانع للأوقات يكفي.
  if (
    end <= start ||
    start > now.getTime() ||
    end > now.getTime() ||
    end - start > SIXTEEN_HOURS_MS
  )
    throw new AttendanceCorrectionError('ATTENDANCE_CORRECTION_INVALID_TIMES');
  if (neighbours.some((other) => attendanceSessionsOverlap(start, end, sessionId, other)))
    throw new AttendanceCorrectionError('ATTENDANCE_CORRECTION_INVALID_TIMES');
}

/**
 * يقارن فترتين دون احتساب الأطراف المتلامسة أو الجلسة نفسها؛ المفتوحة تستمر بلا نهاية معلومة.
 *
 * @param start بداية الفترة بالمللي ثانية
 * @param end نهاية الفترة بالمللي ثانية
 * @param sessionId معرّف الجلسة المستبعدة من المقارنة
 * @param other جلسة أخرى غير ملغاة لنفس الموظف
 * @returns هل تتقاطع الفترتان من الداخل
 */
export function attendanceSessionsOverlap(
  start: number,
  end: number,
  sessionId: string,
  other: AttendanceCorrectionNeighbour,
): boolean {
  if (other.id === sessionId) return false;
  const otherStart = instant(other.clock_in).getTime();
  const otherEnd =
    other.clock_out === null ? Number.POSITIVE_INFINITY : instant(other.clock_out).getTime();
  // الأطراف المتلامسة ليست تداخلاً: الخروج يساوي دخول التالية.
  return start < otherEnd && otherStart < end;
}

function buildPlan(
  session: AttendanceCorrectionSession,
  clockIn: Date,
  clockOut: Date,
  closedBy: 'EMPLOYEE' | 'MISSED_OUT',
  reason: string,
  clockInChanged: boolean,
): AttendanceCorrectionPlan {
  const previousIn = instant(session.clock_in);
  const previousOut = instant(session.clock_out as string);
  const corrections: PlannedAttendanceCorrection[] = [];
  if (clockIn.getTime() !== previousIn.getTime())
    corrections.push({
      field: 'CLOCK_IN',
      before: previousIn.toISOString(),
      after: clockIn.toISOString(),
      reason,
    });
  if (clockOut.getTime() !== previousOut.getTime())
    corrections.push({
      field: 'CLOCK_OUT',
      before: previousOut.toISOString(),
      after: clockOut.toISOString(),
      reason,
    });
  // قرار المالك 2026-10-08 (CA-Q7 وCA-Q10): الحالة وسبب الإغلاق يبقيان. التأخير يُعاد من بداية الوردية المثبتة عند تغيّر الدخول فقط.
  const late = clockInChanged
    ? attendanceLateMinutes(
        session.scheduled_start === null ? null : instant(session.scheduled_start),
        clockIn,
      )
    : session.late_minutes;
  return {
    clock_in: clockIn.toISOString(),
    clock_out: clockOut.toISOString(),
    late_minutes: late,
    revision: session.revision + 1,
    status: session.status as 'CLOSED' | 'MISSED_OUT',
    closed_by: closedBy,
    working_date: session.working_date,
    corrections,
  };
}
