import type { AttendanceMonthlyReport, AttendanceMonthlyReportRow } from '@pospay/contracts';
import { attendanceDecimalHours, attendanceHoursMinutes } from '@pospay/domain';

/* eslint-disable no-restricted-syntax -- brief 27b explicitly authorizes a fixed Arabic CSV header map within the staff fence. */
const HEADERS = ['اسم الموظفة','أيام الحضور','ساعات العمل','ساعات العمل العشرية','ساعات الجدول','ساعات الجدول العشرية',
  'الساعات المتفق عليها','الساعات المتفق عليها العشرية','الفرق','الفرق العشري','عدد التأخير','دقائق التأخير',
  'ناقص بصمة خروج','أيام يدوية','أيام إجازة سنوية','ساعات إجازة سنوية جزئية','أيام إجازة مرضية',
  'ساعات إجازة مرضية جزئية','أيام إجازة بدون راتب','ساعات إجازة بدون راتب جزئية','أيام إجازة أخرى','ساعات إجازة أخرى جزئية'];
/* eslint-enable no-restricted-syntax */

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
  return [safeName, row.days_present, ...hours, row.late_count, row.late_minutes,
    row.missing_clock_out, row.manual_days,
    ...row.leave.flatMap((leave) => [leave.days, attendanceDecimalHours(leave.partial_minutes)])]
    .map(quote).join(',');
}
export function attendanceMonthlyCsv(report: AttendanceMonthlyReport): string {
  return `${String.fromCharCode(0xfeff)}${[HEADERS.map(quote).join(','), ...report.rows.map(csvRow)].join('\r\n')}\r\n`;
}
