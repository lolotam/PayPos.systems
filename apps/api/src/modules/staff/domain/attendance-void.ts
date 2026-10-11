import { AttendanceChangeError } from './attendance-change-request.ts';
import {
  attendanceSessionsOverlap,
  type AttendanceCorrectionNeighbour,
} from './attendance-correction.ts';

/** حقائق الجلسة اللازمة للإلغاء والاسترجاع؛ المصدر وحقائق المسح لا تتغير. */
export interface AttendanceVoidSession {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  clock_in: string;
  clock_out: string | null;
  revision: number;
  voided_at: string | null;
}
/** العلامات مستقلة عن حالة الإغلاق حتى تظل حقيقة الخروج الفائت محفوظة. */
export interface AttendanceVoidPlan {
  voided_at: string | null;
  voided_by: string | null;
  void_request_id: string | null;
  revision: number;
}
/** نسخة الجلسة التي رآها مقدم الطلب تمنع تطبيق قرار على حقائق تغيرت. */
export interface AttendanceVoidRequest {
  session_revision: number;
}
/** وقت الموافقة وصاحبها والطلب المحجوز؛ مقدم الطلب محفوظ في سجل الطلب. */
export interface AttendanceVoidContext {
  now: Date;
  approverId: string;
  requestId: string;
}
/** الجلسات غير الملغاة المقروءة تحت قفل حالة الموظف تشمل جلسته المفتوحة. */
export interface AttendanceRestoreContext {
  neighbours: readonly AttendanceCorrectionNeighbour[];
}

function nextRevision(session: AttendanceVoidSession, request: AttendanceVoidRequest): number {
  if (session.revision !== request.session_revision || session.revision >= 2147483647)
    throw new AttendanceChangeError('ATTENDANCE_SESSION_REVISION_CONFLICT');
  return session.revision + 1;
}

/**
 * يخطط إلغاء جلسة مغلقة فقط دون مساس بالتوقيت أو التاريخ؛ الملغاة تُرفض قبل المفتوحة ثم النسخة.
 *
 * @param session الجلسة المقفولة عند الطلب أو الموافقة
 * @param request النسخة المشاهدة
 * @param context لحظة القرار وصاحبه ومعرّف طلبه
 * @returns علامات الإلغاء ونسخة الجلسة التالية
 */
export function planAttendanceVoid(
  session: AttendanceVoidSession,
  request: AttendanceVoidRequest,
  context: AttendanceVoidContext,
): AttendanceVoidPlan {
  if (session.voided_at !== null) throw new AttendanceChangeError('ATTENDANCE_SESSION_VOIDED');
  if (session.status === 'OPEN') throw new AttendanceChangeError('ATTENDANCE_SESSION_OPEN');
  const revision = nextRevision(session, request);
  return {
    voided_at: context.now.toISOString(),
    voided_by: context.approverId,
    void_request_id: context.requestId,
    revision,
  };
}

/**
 * يعيد الجلسة الملغاة بعد مطابقة نسختها ومنع تداخلها مع حضور غير ملغى؛ تلامس الأطراف مسموح.
 *
 * @param session الجلسة الملغاة المقفولة
 * @param request النسخة المشاهدة للإلغاء المطلوب التراجع عنه
 * @param context الجلسات غير الملغاة لنفس الموظف، بما فيها المفتوحة
 * @returns علامات فارغة ونسخة تالية مع بقاء طلب الإلغاء الأصلي في التاريخ
 */
export function planAttendanceRestore(
  session: AttendanceVoidSession,
  request: AttendanceVoidRequest,
  context: AttendanceRestoreContext,
): AttendanceVoidPlan {
  if (session.voided_at === null) throw new AttendanceChangeError('ATTENDANCE_SESSION_NOT_VOIDED');
  const revision = nextRevision(session, request);
  const start = new Date(session.clock_in).getTime();
  const end =
    session.clock_out === null ? Number.POSITIVE_INFINITY : new Date(session.clock_out).getTime();
  if (context.neighbours.some((other) => attendanceSessionsOverlap(start, end, session.id, other)))
    throw new AttendanceChangeError('ATTENDANCE_RESTORE_OVERLAP');
  return { voided_at: null, voided_by: null, void_request_id: null, revision };
}
