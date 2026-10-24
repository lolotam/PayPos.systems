import type { AttendanceOpenSession, AttendancePeriod, ReportBranchInputs, ReportLeave } from './attendance-report-types.js';
import { attendanceContractPeriodDates, attendanceLeaveCoversDate, attendancePeriodDates } from './attendance-period-dates.js';
import { attendanceShiftHasEnded } from './attendance-statement-cutoff.js';
import { isCountedAttendanceSession, workedAttendanceMinutesByDate } from './attendance-worked-minutes.js';

/** نوع الإجازة المعروضة في يوم واحد من بيان الموظفة. */
export type AttendanceStatementLeaveType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';

/** جلسة يوم واحد في بيان الموظفة؛ أوقات البصمة لحظات ISO، والصياغة شغل مصدر الـ worker. */
export interface AttendanceStatementDaySession {
  clock_in: string;
  clock_out: string | null;
  late_minutes: number;
  manual: boolean;
  counted: boolean;
  missing_clock_out: boolean;
}

/** يوم واحد من بيان الموظفة. */
export interface AttendanceStatementDay {
  date: string;
  sessions: AttendanceStatementDaySession[];
  worked_minutes: number;
  still_in: boolean;
  leave: AttendanceStatementLeaveType[];
  scheduled: { starts_at: string; ends_at: string }[];
  no_attendance: boolean;
}

function leaveTypesOnDate(leaves: readonly ReportLeave[], date: string): AttendanceStatementLeaveType[] {
  const types = new Set<AttendanceStatementLeaveType>();
  for (const leave of leaves) {
    if (attendanceLeaveCoversDate(leave, date)) types.add(leave.type);
  }
  return (['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const).filter((type) => types.has(type));
}

/**
 * يبني صف يوم بيوم لبيان الموظفة؛ كل يوم في الفترة ليه سطر حتى لو مفيش فيه حاجة (Story 2.2).
 * البصمة الناقصة من غير تصحيح بتضيف صفر ساعة (BR-05)، والوردية اللي ما خلصتش ما بتتحسبش (FR-013a).
 * الجلسة المفتوحة بتطبع «لسه جوّه» وما بتخفيش «لا يوجد حضور مسجّل».
 *
 * @param branch مدخلات الموظفة في الفرع
 * @param openSessions جلسات الموظفة المفتوحة في الفترة
 * @param period الفترة المطلوبة، الطرفين مشمولين
 * @param cutoff لحظة الطلب
 * @returns سطر لكل يوم في الفترة بترتيب التاريخ
 */
export function computeAttendanceStatementDays(branch: ReportBranchInputs, openSessions: readonly AttendanceOpenSession[],
  period: AttendancePeriod, cutoff: string): AttendanceStatementDay[] {
  const worked = workedAttendanceMinutesByDate(branch.sessions, branch.shifts);
  const contractDates = new Set(attendanceContractPeriodDates(branch.contract, period).map(({ date }) => date));
  return attendancePeriodDates(period).map(({ date }) => {
    const sessions = branch.sessions.filter((session) => session.working_date === date && !session.voided)
      .toSorted((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in))
      .map((session) => ({ clock_in: session.clock_in, clock_out: session.clock_out,
        late_minutes: session.late_minutes, manual: session.source === 'MANUAL',
        counted: isCountedAttendanceSession(session),
        missing_clock_out: session.status === 'MISSED_OUT' && !session.clock_out_corrected }));
    const scheduled = branch.shifts.filter((shift) => shift.working_date === date && attendanceShiftHasEnded(shift, cutoff))
      .toSorted((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
      .map((shift) => ({ starts_at: shift.starts_at, ends_at: shift.ends_at }));
    const still_in = openSessions.some((session) => session.working_date === date);
    const leave = contractDates.has(date) ? leaveTypesOnDate(branch.leave_for_branch, date) : [];
    const counted = sessions.some((session) => session.counted);
    return { date, sessions, worked_minutes: worked.get(date) ?? 0, still_in, leave, scheduled,
      no_attendance: scheduled.length > 0 && !counted && !still_in };
  });
}
