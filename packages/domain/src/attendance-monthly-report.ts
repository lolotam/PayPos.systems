import type { ReportBranchInputs } from './attendance-report-types.js';
import { attendanceContractedMinutes, attendanceLeaveSummary } from './attendance-contracted-minutes.js';
import { attendanceLateness, isCountedAttendanceSession, workedAttendanceMinutes } from './attendance-worked-minutes.js';

/**
 * يجمع تقرير الموظفة في فرع أو كل فروع النشاط؛ الحضور أيام مميزة واليدوي عدد جلسات وفق مواصفة 049 §5.
 * الفرق عمل ناقص التعاقد بعد الإجازة؛ كل الحسابات هنا لتظل القراءة إسقاطاً بلا قواعد مكررة.
 * الإجازة تخص الموظفة وفق AB-Q11، فتُحسب مرة لكل معرّف طلب مهما تكررت في مدخلات الفروع.
 *
 * @param branches مدخلات الموظفة لكل فرع مصرح به
 * @param month الشهر الميلادي المطلوب
 * @returns أعمدة التقرير الصحيحة بالدقائق دون بيانات شخصية حساسة
 */
export function computeAttendanceMonthlyReport(branches: readonly ReportBranchInputs[], month: string) {
  const sessions = branches.flatMap((branch) => branch.sessions).filter((session) => session.working_date.startsWith(`${month}-`));
  const counted = sessions.filter(isCountedAttendanceSession);
  const worked_minutes = branches.reduce((sum, branch) => sum + workedAttendanceMinutes(branch.sessions, branch.shifts, month), 0);
  const scheduled_minutes = branches.reduce((sum, branch) => sum + branch.shifts
    .filter((shift) => shift.working_date.startsWith(`${month}-`))
    .reduce((minutes, shift) => minutes + Math.floor((Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 60_000), 0), 0);
  const contracted_minutes = branches.reduce((sum, branch) => sum + attendanceContractedMinutes(branch.contract, month, branch.leave_for_branch, branch.timezone), 0);
  const employeeLeave = new Map(branches.flatMap((branch) => branch.leave_for_branch).map((entry) => [entry.id, entry]));
  const leave = attendanceLeaveSummary([...employeeLeave.values()], month);
  return { days_present: new Set(counted.map((session) => session.working_date)).size,
    worked_minutes, scheduled_minutes, contracted_minutes,
    leave,
    difference_minutes: worked_minutes - contracted_minutes, ...attendanceLateness(sessions),
    missing_clock_out: sessions.filter((session) => !session.voided && session.status === 'MISSED_OUT' && !session.clock_out_corrected).length,
    manual_days: counted.filter((session) => session.source === 'MANUAL').length };
}
