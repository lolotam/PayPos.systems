import type { AttendanceMonthlyReport, AttendanceMonthlyReportRow } from '@pospay/contracts';
import { attendanceDecimalHours, attendanceHoursMinutes } from '@pospay/domain';
import { t, type MessageKey } from '@pospay/i18n';

const HEADER_KEYS = [
  'attendanceReport.employeeNumber',
  'attendanceReport.employeeName',
  'attendanceReport.daysPresent',
  'attendanceReport.workedHours',
  'attendanceReport.workedDecimalHours',
  'attendanceReport.scheduledHours',
  'attendanceReport.scheduledDecimalHours',
  'attendanceReport.contractedHours',
  'attendanceReport.contractedDecimalHours',
  'attendanceReport.difference',
  'attendanceReport.decimalDifference',
  'attendanceReport.lateCount',
  'attendanceReport.lateMinutes',
  'attendanceReport.missingClockOut',
  'attendanceReport.manualDays',
  'attendanceReport.annualLeaveDays',
  'attendanceReport.annualPartialLeaveHours',
  'attendanceReport.sickLeaveDays',
  'attendanceReport.sickPartialLeaveHours',
  'attendanceReport.unpaidLeaveDays',
  'attendanceReport.unpaidPartialLeaveHours',
  'attendanceReport.otherLeaveDays',
  'attendanceReport.otherPartialLeaveHours',
] as const satisfies readonly MessageKey[];

function quote(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
function csvRow(row: AttendanceMonthlyReportRow) {
  // الاسم الحر قد يبدأ بصيغة Excel؛ نحفظه كنص، وتبقى الأعمدة الرقمية السالبة أرقاماً قابلة للجمع.
  const name = row.name_ar ?? row.name_en;
  const safeName = /^[=+@\-\t\r\n]/.test(name) ? `'${name}` : name;
  const hours = [row.worked_minutes, row.scheduled_minutes, row.contracted_minutes, row.difference_minutes]
    .flatMap((minutes) => [attendanceHoursMinutes(minutes), attendanceDecimalHours(minutes)]);
  return [row.employee_number, safeName, row.days_present, ...hours, row.late_count, row.late_minutes,
    row.missing_clock_out, row.manual_days,
    ...row.leave.flatMap((leave) => [leave.days, attendanceDecimalHours(leave.partial_minutes)])]
    .map(quote).join(',');
}
export function attendanceMonthlyCsv(report: AttendanceMonthlyReport): string {
  return `${String.fromCharCode(0xfeff)}${[HEADER_KEYS.map((key) => quote(t('ar', key))).join(','), ...report.rows.map(csvRow)].join('\r\n')}\r\n`;
}
