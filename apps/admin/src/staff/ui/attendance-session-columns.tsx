import type { AttendanceBoard, AttendanceCapabilities } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { boardTime } from '../model/attendance-board-display';
import { displayEmployeeNumber } from '../model/employee-number-display';
import { AttendanceSessionBadges } from './attendance-session-badges';
import { AttendanceSourceBadge } from './attendance-source-badge';
import { AttendanceSessionActions, type SessionAction } from './attendance-session-actions';
type Row = AttendanceBoard['sessions'][number];
export function attendanceSessionColumns(
  locale: Locale,
  timezone: string,
  onAction: (row: Row, action: SessionAction) => void,
  capabilities: AttendanceCapabilities,
  owner = false,
): ColumnDef<Row>[] {
  return [
    {
      id: 'number',
      header: t(locale, 'attendanceBoard.employeeNumber'),
      cell: ({ row }) => displayEmployeeNumber(row.original.employee_number),
    },
    {
      id: 'employee',
      header: t(locale, 'attendanceBoard.employee'),
      cell: ({ row: { original: r } }) => (locale === 'ar' ? (r.name_ar ?? r.name_en) : r.name_en),
    },
    {
      id: 'in',
      header: t(locale, 'attendanceBoard.clockIn'),
      cell: ({ row }) => boardTime(row.original.clock_in, locale, timezone),
    },
    {
      id: 'out',
      header: t(locale, 'attendanceBoard.clockOut'),
      cell: ({ row }) => boardTime(row.original.clock_out, locale, timezone),
    },
    attendanceSessionStatusColumn(locale),
    {
      id: 'source',
      header: t(locale, 'attendanceBoard.source'),
      cell: ({ row }) => (
        <AttendanceSourceBadge source={row.original.source} manual={row.original.manual} />
      ),
    },
    { id: 'late', header: t(locale, 'attendanceBoard.late'), accessorKey: 'late_minutes' },
    {
      id: 'exceptions',
      header: t(locale, 'attendanceBoard.exceptions'),
      cell: ({ row }) => <AttendanceSessionBadges row={row.original} />,
    },
    {
      id: 'actions',
      header: t(locale, 'attendanceActions.actions'),
      cell: ({ row }) => (
        <AttendanceSessionActions
          row={row.original}
          onAction={onAction}
          capabilities={capabilities}
          owner={owner}
        />
      ),
    },
  ];
}

function attendanceSessionStatusColumn(locale: Locale): ColumnDef<Row> {
  return {
    id: 'status',
    header: t(locale, 'attendanceBoard.status'),
    cell: ({ row }) => (
      <Badge
        variant={
          row.original.status === 'MISSED_OUT'
            ? 'warning'
            : row.original.status === 'CLOSED'
              ? 'success'
              : 'info'
        }
      >
        {t(locale, `attendanceBoard.${row.original.status}`)}
      </Badge>
    ),
  };
}
