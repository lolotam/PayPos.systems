'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useMemo, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceCapabilities } from '../api/use-attendance-capabilities';
import { attendanceSessionActions } from '../model/attendance-action-display';
import type { SessionAction } from './attendance-session-actions';
import { AttendanceSessionEditor } from './attendance-session-editor';
import { AttendanceActionsTable } from './attendance-actions-table';
import { attendanceSessionColumns } from './attendance-session-columns';
export function AttendanceSessionsTable({
  board,
  scope,
}: {
  board: AttendanceBoard;
  scope: AttendanceBoardScope;
}) {
  const locale = useLocale();
  const { capabilities } = useAttendanceCapabilities(scope);
  const [selection, setSelection] = useState<{
    row: AttendanceBoard['sessions'][number];
    action: SessionAction;
  }>();
  const columns = useMemo(
    () =>
      attendanceSessionColumns(
        locale,
        board.timezone,
        (row, action) => setSelection({ row, action }),
        capabilities,
        board.owner,
      ),
    [locale, board.timezone, capabilities, board.owner],
  );
  return (
    <section aria-labelledby="attendance-sessions" className="flex min-w-0 flex-col gap-3">
      <DataTableFrame
        stacked
        title={
          <span id="attendance-sessions" className="text-lg font-semibold">
            {t(locale, 'attendanceBoard.sessions')}
          </span>
        }
      >
        {board.sessions.length ? (
          <AttendanceActionsTable items={board.sessions} columns={columns} />
        ) : (
          <p className="p-4">{t(locale, 'attendanceBoard.emptySessions')}</p>
        )}
      </DataTableFrame>
      {selection &&
      (selection.action === 'history' ||
        attendanceSessionActions(selection.row, capabilities, board.owner)[
          selection.action === 'void' ? 'void' : 'correct'
        ]) ? (
        <AttendanceSessionEditor
          scope={scope}
          row={selection.row}
          action={selection.action}
          timezone={board.timezone}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </section>
  );
}
