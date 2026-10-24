import type { AttendancePeriod, ReportBranchInputs } from './attendance-report-types.js';
import { attendanceContractPeriodDates } from './attendance-period-dates.js';
import { attendanceContractedPeriodMinutes, attendanceLeaveSummary } from './attendance-contracted-minutes.js';
import { attendanceLateness, isCountedAttendanceSession, workedAttendanceMinutesByDate } from './attendance-worked-minutes.js';
import { attendanceShiftHasEnded } from './attendance-statement-cutoff.js';

/** أعمدة تقرير الحضور كما هي في مواصفة 049 §5، والدقيقة هي وحدة الحساب. */
export type AttendanceLeaveSummary = ReturnType<typeof attendanceLeaveSummary>;

/** صف الموظفة في بيان الحضور: نفس أعمدة تقرير 27b. */
export interface AttendancePeriodReport {
  days_present: number;
  worked_minutes: number;
  scheduled_minutes: number;
  contracted_minutes: number;
  leave: AttendanceLeaveSummary;
  difference_minutes: number;
  late_count: number;
  late_minutes: number;
  missing_clock_out: number;
  manual_days: number;
}

function periodMinutes(byDate: ReadonlyMap<string, number>, period: AttendancePeriod): number {
  return [...byDate].filter(([date]) => date >= period.from && date <= period.to)
    .reduce((minutes, [, elapsed]) => minutes + elapsed, 0);
}

/**
 * يجمع تقرير الموظفة في فرع أو كل فروع النشاط عن فترة من يوم لحد يوم؛ الأعمدة هي أعمدة 27b بالظبط.
 * الفرق عمل ناقص التعاقد بعد الإجازة؛ كل الحسابات هنا لتظل القراءة إسقاطاً بلا قواعد مكررة.
 * الإجازة تخص الموظفة وفق AB-Q11، فتُحسب مرة لكل معرّف طلب مهما تكررت في مدخلات الفروع.
 * لحظة الطلب بتقطع الدوام والورديات المجدولة بس؛ الجلسات ما بتتقطعش (FR-013a).
 *
 * @param branches مدخلات الموظفة لكل فرع مصرح به
 * @param period الفترة المطلوبة، الطرفين مشمولين
 * @param cutoff لحظة الطلب أو null لما مفيش حد
 * @returns أعمدة التقرير الصحيحة بالدقائق دون بيانات شخصية حساسة
 */
export function computeAttendancePeriodReport(branches: readonly ReportBranchInputs[], period: AttendancePeriod,
  cutoff: string | null): AttendancePeriodReport {
  const sessions = branches.flatMap((branch) => branch.sessions)
    .filter((session) => session.working_date >= period.from && session.working_date <= period.to);
  const counted = sessions.filter(isCountedAttendanceSession);
  const worked_minutes = branches.reduce((sum, branch) =>
    sum + periodMinutes(workedAttendanceMinutesByDate(branch.sessions, branch.shifts), period), 0);
  const scheduled_minutes = branches.reduce((sum, branch) => sum + branch.shifts
    .filter((shift) => shift.working_date >= period.from && shift.working_date <= period.to && attendanceShiftHasEnded(shift, cutoff))
    .reduce((minutes, shift) => minutes + Math.floor((Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 60_000), 0), 0);
  const contracted_minutes = branches.reduce((sum, branch) =>
    sum + attendanceContractedPeriodMinutes(branch.contract, period, branch.leave_for_branch, branch.timezone, cutoff), 0);
  const employeeLeave = new Map(branches.flatMap((branch) => branch.leave_for_branch).map((entry) => [entry.id, entry]));
  const dates = branches.flatMap((branch) => attendanceContractPeriodDates(branch.contract, period));
  const leave = attendanceLeaveSummary([...employeeLeave.values()], dates);
  return { days_present: new Set(counted.map((session) => session.working_date)).size,
    worked_minutes, scheduled_minutes, contracted_minutes,
    leave,
    difference_minutes: worked_minutes - contracted_minutes, ...attendanceLateness(sessions),
    missing_clock_out: sessions.filter((session) => !session.voided && session.status === 'MISSED_OUT' && !session.clock_out_corrected).length,
    manual_days: counted.filter((session) => session.source === 'MANUAL').length };
}
