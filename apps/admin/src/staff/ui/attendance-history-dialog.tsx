'use client';
import type { AttendanceCorrectionHistory } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceHistory } from '../api/use-attendance-actions-read';
import { attendanceActor } from '../model/attendance-action-display';
import { boardAccessLost, boardTime } from '../model/attendance-board-display';
import { AttendanceActionDialog } from './attendance-action-dialog';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceActionsTable } from './attendance-actions-table';
export function AttendanceHistoryDialog({
  scope,
  sessionId,
  timezone,
  onClose,
}: {
  scope: AttendanceBoardScope;
  sessionId: string;
  timezone: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const query = useAttendanceHistory(scope, sessionId);
  const columns: ColumnDef<AttendanceCorrectionHistory['items'][number]>[] = [
    {
      id: 'field',
      header: t(locale, 'attendanceActions.kind'),
      cell: ({ row }) => t(locale, `attendanceActions.${row.original.field}`),
    },
    {
      id: 'times',
      header: `${t(locale, 'attendanceActions.before')} → ${t(locale, 'attendanceActions.after')}`,
      cell: ({ row }) => (
        <span>
          {boardTime(row.original.before_at, locale, timezone)} →{' '}
          {boardTime(row.original.after_at, locale, timezone)}
        </span>
      ),
    },
    { accessorKey: 'reason', header: t(locale, 'attendanceActions.reason') },
    {
      id: 'by',
      header: t(locale, 'attendanceActions.by'),
      cell: ({ row }) => attendanceActor(row.original.corrected_by.name, locale),
    },
    {
      id: 'at',
      header: t(locale, 'attendanceActions.at'),
      cell: ({ row }) => boardTime(row.original.corrected_at, locale, timezone),
    },
  ];
  return (
    <AttendanceActionDialog title={t(locale, 'attendanceActions.history')} onClose={onClose}>
      <AttendanceActionFeedback
        error={query.error}
        loading={query.isPending}
        onRetry={() => {
          void query.refetch();
        }}
      />
      {query.data && !boardAccessLost(query.error) ? (
        <AttendanceActionsTable items={query.data.items} columns={columns} />
      ) : null}
      <Button variant="outline" onClick={onClose}>
        {t(locale, 'attendanceActions.close')}
      </Button>
    </AttendanceActionDialog>
  );
}
