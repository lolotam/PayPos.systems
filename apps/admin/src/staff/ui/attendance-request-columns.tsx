import { t, type Locale } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import type { WorkspaceBranch } from '@pospay/contracts';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { attendanceActor, type AttendanceRequestRow } from '../model/attendance-action-display';
import { boardTime } from '../model/attendance-board-display';
import { AttendanceRequestRowActions, type RequestAction } from './attendance-request-row-actions';
export function attendanceRequestColumns(
  locale: Locale,
  timezone: string,
  scope: AttendanceBoardScope,
  branches: WorkspaceBranch[],
  onAction: (row: AttendanceRequestRow, action: RequestAction) => void,
): ColumnDef<AttendanceRequestRow>[] {
  return [
    attendanceRequestBranchColumn(locale, branches),
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
    ...attendanceRequestActorColumns(locale, timezone, branches),
    {
      id: 'actions',
      header: t(locale, 'attendanceActions.actions'),
      cell: ({ row }) => (
        <AttendanceRequestRowActions
          row={row.original}
          scope={{ ...scope, branchId: row.original.branch_id }}
          onAction={onAction}
        />
      ),
    },
  ];
}

function attendanceRequestBranchColumn(
  locale: Locale,
  branches: WorkspaceBranch[],
): ColumnDef<AttendanceRequestRow> {
  return {
    id: 'branch',
    header: t(locale, 'attendanceBoard.branch'),
    cell: ({ row }) => {
      const branch = branches.find((entry) => entry.id === row.original.branch_id);
      return branch
        ? locale === 'ar'
          ? (branch.name_ar ?? branch.name_en)
          : branch.name_en
        : t(locale, 'attendanceBoard.unavailable');
    },
  };
}

function attendanceRequestActorColumns(
  locale: Locale,
  timezone: string,
  branches: WorkspaceBranch[],
): ColumnDef<AttendanceRequestRow>[] {
  const rowTimezone = (row: AttendanceRequestRow) =>
    row.requested?.timezone ??
    branches.find((branch) => branch.id === row.branch_id)?.effective_timezone ??
    timezone;
  return [
    {
      id: 'requester',
      header: t(locale, 'attendanceActions.requestedBy'),
      cell: ({ row }) => attendanceActor(row.original.requested_by_name, locale),
    },
    {
      id: 'requestedAt',
      header: t(locale, 'attendanceActions.at'),
      cell: ({ row }) => boardTime(row.original.requested_at, locale, rowTimezone(row.original)),
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
      cell: ({ row }) => boardTime(row.original.decided_at, locale, rowTimezone(row.original)),
    },
    { accessorKey: 'decision_reason', header: t(locale, 'attendanceActions.optionalReason') },
  ];
}
