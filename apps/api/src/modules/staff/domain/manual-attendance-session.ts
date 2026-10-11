import { AttendanceChangeError } from './attendance-change-request.ts';
import { attendanceIntervalRefused, type AttendanceInterval } from './attendance-interval.ts';
import {
  attendanceWorkingDate,
  attendanceEligible,
  attendanceSchedule,
  attendanceLateMinutes,
} from './clock-attendance.ts';

/** اليوم اليدوي مكتمل الطرفين بلا استراحات طبقاً لقرار ACR-Q14. */
export interface ManualSessionInput {
  branch_id: string;
  clock_in: string;
  clock_out: string;
}
/** حقائق تاريخية يعاد تحميلها تحت قفل الموظف عند الموافقة. */
export interface ManualSessionContext {
  now: Date;
  timezone: string;
  employee: Parameters<typeof attendanceEligible>[0];
  shifts: Parameters<typeof attendanceSchedule>[0];
  neighbours: readonly AttendanceInterval[];
  pending: readonly AttendanceInterval[];
  selfRequestId: string | null;
  stored?: { working_date: string; timezone: string } | null;
}
/** لقطة اليوم والوردية والتأخير؛ لا ساعات مستحقة ولا أثر على العمولة. */
export interface ManualSessionPlan {
  working_date: string;
  timezone: string;
  clock_in: string;
  clock_out: string;
  late_minutes: number;
  scheduled_start: string | null;
  scheduled_end: string | null;
}

/**
 * يخطط يوماً يدوياً وفق ACR-Q14…Q17: الوقت ثم الأهلية والتداخل ثم لقطة الوردية والتأخير.
 * يعاد الفحص عند الموافقة، وتغير توقيت الفرع بعد التقديم يرفض الموافقة بكود مستقل حتى يُرفض الطلب ويُقدَّم من جديد.
 *
 * @param input الفرع وطرفا اليوم المطلوب
 * @param context حقائق الموظف والجلسات والطلبات والوقت المحقون
 * @returns قيم جلسة مغلقة يدوية أو رفض مسمى
 */
export function planManualSession(
  input: ManualSessionInput,
  context: ManualSessionContext,
): ManualSessionPlan {
  const start = new Date(input.clock_in);
  const end = new Date(input.clock_out);
  if (attendanceIntervalRefused(start, end, context.now, [], null))
    throw new AttendanceChangeError('ATTENDANCE_MANUAL_INVALID_TIMES');
  const date = attendanceWorkingDate(start, context.timezone);
  if (
    context.stored &&
    (context.stored.working_date !== date || context.stored.timezone !== context.timezone)
  )
    throw new AttendanceChangeError('ATTENDANCE_MANUAL_TIMEZONE_CHANGED');
  if (!attendanceEligible(context.employee, input.branch_id, date))
    throw new AttendanceChangeError('ATTENDANCE_MANUAL_NOT_ELIGIBLE');
  if (attendanceIntervalRefused(start, end, context.now, context.neighbours, null))
    throw new AttendanceChangeError('ATTENDANCE_MANUAL_INVALID_TIMES');
  if (attendanceIntervalRefused(start, end, context.now, context.pending, context.selfRequestId))
    throw new AttendanceChangeError('ATTENDANCE_CHANGE_DUPLICATE_PENDING');
  const shift = attendanceSchedule(context.shifts, start, date);
  return {
    working_date: date,
    timezone: context.timezone,
    clock_in: start.toISOString(),
    clock_out: end.toISOString(),
    late_minutes: attendanceLateMinutes(shift?.startsAt ?? null, start),
    scheduled_start: shift?.startsAt.toISOString() ?? null,
    scheduled_end: shift?.endsAt.toISOString() ?? null,
  };
}
