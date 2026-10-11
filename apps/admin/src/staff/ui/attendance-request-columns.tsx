import { t, type Locale } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { attendanceActor, type AttendanceRequestRow } from '../model/attendance-action-display';
import { boardTime } from '../model/attendance-board-display';
import { AttendanceRequestRowActions, type RequestAction } from './attendance-request-row-actions';
export function attendanceRequestColumns(
  locale: Locale,
  onAction: (row: AttendanceRequestRow, action: RequestAction) => void,
): ColumnDef<AttendanceRequestRow>[] {
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
      cell: ({ row }) => t(locale, `attendanceActions.${row.original.kind}`),
    },
    {
      id: 'status',
      header: t(locale, 'attendanceBoard.status'),
      cell: ({ row }) => <Badge>{t(locale, `attendanceActions.${row.original.status}`)}</Badge>,
    },
    {
      id: 'times',
      header: t(locale, 'attendanceBoard.date'),
      cell: ({ row }) =>
        row.original.requested ? (
          <span>
            {boardTime(row.original.requested.clock_in, locale, row.original.requested.timezone)} →{' '}
            {boardTime(row.original.requested.clock_out, locale, row.original.requested.timezone)}
          </span>
        ) : (
          t(locale, 'attendanceBoard.unavailable')
        ),
    },
    { accessorKey: 'reason', header: t(locale, 'attendanceActions.reason') },
    ...attendanceRequestActorColumns(locale),
    {
      id: 'actions',
      header: t(locale, 'attendanceActions.actions'),
      cell: ({ row }) => <AttendanceRequestRowActions row={row.original} onAction={onAction} />,
    },
  ];
}

function attendanceRequestActorColumns(locale: Locale): ColumnDef<AttendanceRequestRow>[] {
  return [
    {
      id: 'requester',
      header: t(locale, 'attendanceActions.requestedBy'),
      cell: ({ row }) => attendanceActor(row.original.requested_by_name, locale),
    },
    {
      id: 'requestedAt',
      header: t(locale, 'attendanceActions.at'),
      cell: ({ row }) =>
        boardTime(row.original.requested_at, locale, row.original.requested?.timezone ?? 'UTC'),
    },
    {
      id: 'decider',
      header: t(locale, 'attendanceActions.decidedBy'),
      cell: ({ row }) =>
        row.original.decided_by
          ? attendanceActor(row.original.decided_by_name, locale)
          : t(locale, 'attendanceBoard.unavailable'),
    },
    {
      id: 'decidedAt',
      header: t(locale, 'attendanceActions.at'),
      cell: ({ row }) =>
        boardTime(row.original.decided_at, locale, row.original.requested?.timezone ?? 'UTC'),
    },
    { accessorKey: 'decision_reason', header: t(locale, 'attendanceActions.optionalReason') },
  ];
}
