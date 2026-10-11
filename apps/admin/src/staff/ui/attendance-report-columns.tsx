import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { attendanceHoursMinutes } from '@pospay/domain';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { signedAttendanceHours } from '../model/attendance-report-display';
import { AttendanceReportLeave } from './attendance-report-leave';

const hours = [
  ['worked_minutes', 'attendanceReport.workedHours'],
  ['scheduled_minutes', 'attendanceReport.scheduledHours'],
  ['contracted_minutes', 'attendanceReport.contractedHours'],
] as const;
const counts = [
  ['days_present', 'attendanceReport.daysPresent'],
  ['late_count', 'attendanceReport.lateCount'],
  ['late_minutes', 'attendanceReport.lateMinutes'],
  ['missing_clock_out', 'attendanceReport.missingClockOut'],
  ['manual_days', 'attendanceReport.manualDays'],
] as const;
function countColumn(
  key: (typeof counts)[number][0],
  label: MessageKey,
  locale: Locale,
): ColumnDef<AttendanceMonthlyReportRow> {
  return { accessorKey: key, header: t(locale, label) };
}
export function attendanceReportColumns(locale: Locale): ColumnDef<AttendanceMonthlyReportRow>[] {
  return [
    {
      id: 'employee',
      header: t(locale, 'attendanceReport.employeeName'),
      accessorFn: (row) => (locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en),
    },
    countColumn('days_present', 'attendanceReport.daysPresent', locale),
    ...hours.map(([key, label]): ColumnDef<AttendanceMonthlyReportRow> => ({
      accessorKey: key,
      header: t(locale, label),
      cell: ({ row }) => <span dir="ltr">{attendanceHoursMinutes(row.original[key])}</span>,
    })),
    {
      id: 'leave',
      header: t(locale, 'attendanceReport.leave'),
      enableSorting: false,
      cell: ({ row }) => <AttendanceReportLeave leave={row.original.leave} />,
    },
    {
      accessorKey: 'difference_minutes',
      header: t(locale, 'attendanceReport.difference'),
      cell: ({ row }) => (
        <Badge variant={row.original.difference_minutes < 0 ? 'warning' : 'neutral'}>
          <span dir="ltr">{signedAttendanceHours(row.original.difference_minutes)}</span>
        </Badge>
      ),
    },
    ...counts.slice(1).map(([key, label]) => countColumn(key, label, locale)),
  ];
}
