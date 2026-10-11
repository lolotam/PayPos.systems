import type { AttendanceExceptionPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { boardTime } from '../model/attendance-board-display';
export type ExceptionRow = AttendanceExceptionPage['items'][number];
export function attendanceExceptionColumns(
  locale: Locale,
  timezone: string,
  onAction: (row: ExceptionRow) => void,
): ColumnDef<ExceptionRow>[] {
  return [
    {
      id: 'employee',
      header: t(locale, 'attendanceBoard.employee'),
      cell: ({ row }) =>
        locale === 'ar'
          ? (row.original.employee.name_ar ?? row.original.employee.name_en)
          : row.original.employee.name_en,
    },
    {
      id: 'kind',
      header: t(locale, 'attendanceActions.kind'),
      cell: ({ row }) => t(locale, `attendanceBoard.${row.original.kind}`),
    },
    {
      id: 'raised',
      header: t(locale, 'attendanceActions.raisedAt'),
      cell: ({ row }) => boardTime(row.original.raised_at, locale, timezone),
    },
    {
      id: 'in',
      header: t(locale, 'attendanceBoard.clockIn'),
      cell: ({ row }) => boardTime(row.original.session.clock_in, locale, timezone),
    },
    {
      id: 'out',
      header: t(locale, 'attendanceBoard.clockOut'),
      cell: ({ row }) => boardTime(row.original.session.clock_out, locale, timezone),
    },
    { accessorKey: 'reason', header: t(locale, 'attendanceActions.reason') },
    {
      id: 'actions',
      header: t(locale, 'attendanceActions.actions'),
      cell: ({ row }) =>
        row.original.kind !== 'SUSPECTED_MISSED_OUT' ? (
          <Button variant="outline" onClick={() => onAction(row.original)}>
            {t(
              locale,
              row.original.status === 'OPEN'
                ? 'attendanceActions.resolve'
                : 'attendanceActions.reopen',
            )}
          </Button>
        ) : null,
    },
  ];
}
