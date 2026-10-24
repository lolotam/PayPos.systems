import type { AttendancePeriod, AttendanceShiftPair, ReportBranchInputs, ReportLeave } from './attendance-report-types.js';
import type { WeekdayDefaultShift } from './default-shifts.js';
import { attendanceContractPeriodDates } from './attendance-period-dates.js';
import { attendanceContractEntryEnded, attendanceLocalFormatter, attendanceLocalMinute } from './attendance-statement-cutoff.js';
import { attendanceShiftMatchesPair } from './attendance-shift-filter.js';
import { isCountedAttendanceSession } from './attendance-worked-minutes.js';

function leaveCoversDate(leave: ReportLeave, date: string): boolean {
  return leave.kind === 'FULL_DAY' ? leave.from <= date && date <= leave.to : leave.from === date;
}

function contractDays(branch: ReportBranchInputs, period: AttendancePeriod): { date: string; entry: WeekdayDefaultShift }[] {
  const defaults = new Map((branch.contract?.entries ?? []).map((entry) => [entry.day, entry]));
  return attendanceContractPeriodDates(branch.contract, period).flatMap(({ date, weekday }) => {
    const entry = defaults.get(weekday);
    return entry === undefined ? [] : [{ date, entry }];
  });
}

/**
 * يقول إن الموظفة عندها تغطية في الفرع خلال الفترة؛ التغطية هي اللي بتخلي لها سطر في البيان.
 * التغطية من غير فلتر: جلسة محتسبة، أو يوم عقد دوامه خلص، أو إجازة على يوم عقد، أو وردية خلصت (FR-013a).
 * مع فلتر الشيفت أيام الشيفت بس هي اللي بتتحسب؛ أيام العقد ما بتتحسبش (BR-11).
 *
 * @param branch مدخلات الموظفة في الفرع
 * @param period الفترة المطلوبة، الطرفين مشمولين
 * @param cutoff لحظة الطلب
 * @param pair زوج الشيفت المطلوب أو null لما مفيش فلتر
 * @returns هل للموظفة تغطية في الفترة
 */
export function hasAttendanceStatementCoverage(branch: ReportBranchInputs, period: AttendancePeriod,
  cutoff: string, pair: AttendanceShiftPair | null): boolean {
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  if (pair !== null) {
    const matching = branch.shifts.filter((shift) => attendanceShiftMatchesPair(shift, branch.timezone, pair));
    const ends = new Set(matching.map((shift) => Date.parse(shift.ends_at)));
    const pairDates = new Set(matching.filter((shift) => inPeriod(shift.working_date)).map((shift) => shift.working_date));
    const kept = branch.sessions.filter((session) => session.scheduled_end !== null && ends.has(Date.parse(session.scheduled_end)));
    if (kept.some((session) => inPeriod(session.working_date) && isCountedAttendanceSession(session))) return true;
    if ([...pairDates].some((date) => branch.leave_for_branch.some((leave) => leaveCoversDate(leave, date)))) return true;
    return matching.some((shift) => inPeriod(shift.working_date) && Date.parse(shift.ends_at) <= Date.parse(cutoff));
  }
  if (branch.sessions.some((session) => inPeriod(session.working_date) && isCountedAttendanceSession(session))) return true;
  const formatter = attendanceLocalFormatter(branch.timezone);
  const cutoffMinute = attendanceLocalMinute(cutoff, formatter);
  const days = contractDays(branch, period);
  if (days.some(({ date, entry }) => attendanceContractEntryEnded(date, entry, cutoffMinute))) return true;
  const contractDates = attendanceContractPeriodDates(branch.contract, period).map(({ date }) => date);
  if (contractDates.some((date) => branch.leave_for_branch.some((leave) => leaveCoversDate(leave, date)))) return true;
  return branch.shifts.some((shift) => inPeriod(shift.working_date) && Date.parse(shift.ends_at) <= Date.parse(cutoff));
}
