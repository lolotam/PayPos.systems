'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useMemo, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
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
  const [selection, setSelection] = useState<{
    row: AttendanceBoard['sessions'][number];
    action: SessionAction;
  }>();
  const columns = useMemo(
    () =>
      attendanceSessionColumns(locale, board.timezone, (row, action) =>
        setSelection({ row, action }),
      ),
    [locale, board.timezone],
  );
  return (
    <section aria-labelledby="attendance-sessions" className="flex min-w-0 flex-col gap-3">
      <h2 id="attendance-sessions" className="text-lg font-semibold">
        {t(locale, 'attendanceBoard.sessions')}
      </h2>
      {board.sessions.length ? (
        <AttendanceActionsTable items={board.sessions} columns={columns} />
      ) : (
        <p>{t(locale, 'attendanceBoard.emptySessions')}</p>
      )}
      {selection ? (
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
