import type { AttendancePeriod, AttendanceShiftPair, ReportBranchInputs, ReportShift } from './attendance-report-types.js';
import { attendanceLeaveSummary } from './attendance-contracted-minutes.js';
import { computeAttendancePeriodReport, type AttendancePeriodReport } from './attendance-period-report.js';

/** صف البيان بفلتر الشيفت: الساعات التعاقدية والفرق بيبقوا فاضيين (BR-11). */
export type AttendanceShiftPeriodReport = Omit<AttendancePeriodReport, 'contracted_minutes' | 'difference_minutes'> & {
  contracted_minutes: number | null;
  difference_minutes: number | null;
};

function attendanceLocalClockFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function attendanceLocalClock(instant: string, formatter: Intl.DateTimeFormat): string {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts['hour']}:${parts['minute']}`;
}

function shiftMatchesPair(shift: ReportShift, pair: AttendanceShiftPair, formatter: Intl.DateTimeFormat): boolean {
  return attendanceLocalClock(shift.starts_at, formatter) === pair.start &&
    attendanceLocalClock(shift.ends_at, formatter) === pair.end;
}

/**
 * يطابق الوردية مع زوج البداية والنهاية بالوقت المحلي للفرع؛ هو معنى الشيفت في فلتر BR-11.
 * الوردية اللي عدت نص الليل بتقارن بنهاية اليوم اللي بعده بالوقت المحلي.
 *
 * @param shift الوردية المقروءة
 * @param timezone منطقة الفرع
 * @param pair زوج البداية والنهاية المطلوب
 * @returns هل الوردية على الزوج ده
 */
export function attendanceShiftMatchesPair(shift: ReportShift, timezone: string, pair: AttendanceShiftPair): boolean {
  return shiftMatchesPair(shift, pair, attendanceLocalClockFormatter(timezone));
}

/**
 * يجمع مدخلات فلتر الشيفت في الفرع: الورديات على الزوج، والجلسات المنسوبة ليها.
 * الجلسة بتنتسب لوردية من الزوج بس لو `scheduled_end` بتاعها هو نفس وقت نهاية الوردية دي؛
 * الجلسة من غير نهاية مجدولة ما بتنتسبش لوردية خالص (FR-013).
 *
 * @param branch مدخلات الموظفة في الفرع
 * @param pair زوج بداية ونهاية الوردية المطلوب
 * @returns الورديات المطابقة للزوج والجلسات المنسوبة ليها
 */
export function attendanceShiftPairInputs(branch: ReportBranchInputs, pair: AttendanceShiftPair) {
  const formatter = attendanceLocalClockFormatter(branch.timezone);
  const matching = branch.shifts.filter((shift) => shiftMatchesPair(shift, pair, formatter));
  const ends = new Set(matching.map((shift) => Date.parse(shift.ends_at)));
  const kept = branch.sessions.filter((session) => session.scheduled_end !== null && ends.has(Date.parse(session.scheduled_end)));
  return { matching, kept };
}

function filterBranchByPair(branch: ReportBranchInputs, pair: AttendanceShiftPair) {
  const { matching, kept } = attendanceShiftPairInputs(branch, pair);
  return { branch: { ...branch, sessions: kept, shifts: matching, contract: null }, matching };
}

/**
 * يجمع أرقام الموظفة عن الفترة مع فلتر شيفت واحد؛ الأيام هي اللي جدولتها على الزوج ده بس.
 * الجلسة بتنتسب للوردية من طرف `scheduled_end` بتاعها؛ الجلسة من غيره بتتشال (FR-013).
 * الساعات التعاقدية والفرق بيبقوا فاضيين لأنهم مش مرتبطين بشيفت (BR-11).
 * عمود الإجازة بيحسب الإجازة على أيام الزوج بس (ST-Q7).
 *
 * @param branches مدخلات الموظفة لكل فرع مصرح به
 * @param period الفترة المطلوبة، الطرفين مشمولين
 * @param cutoff لحظة الطلب أو null لما مفيش حد
 * @param pair زوج بداية ونهاية الوردية المطلوب
 * @returns أعمدة التقرير مع الفاضل في التعاقد والفرق
 */
export function computeAttendanceShiftPeriodReport(branches: readonly ReportBranchInputs[], period: AttendancePeriod,
  cutoff: string | null, pair: AttendanceShiftPair): AttendanceShiftPeriodReport {
  const filtered = branches.map((branch) => filterBranchByPair(branch, pair));
  const report = computeAttendancePeriodReport(filtered.map((entry) => entry.branch), period, cutoff);
  const pairDates = [...new Set(filtered.flatMap((entry) => entry.matching
    .filter((shift) => shift.working_date >= period.from && shift.working_date <= period.to)
    .map((shift) => shift.working_date)))];
  const employeeLeave = new Map(branches.flatMap((branch) => branch.leave_for_branch).map((entry) => [entry.id, entry]));
  return { ...report, contracted_minutes: null, difference_minutes: null,
    leave: attendanceLeaveSummary([...employeeLeave.values()], pairDates.map((date) => ({ date }))) };
}
