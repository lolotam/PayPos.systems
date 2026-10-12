'use client';
import type { AttendanceChangeListQuery } from '@pospay/contracts';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceRequests } from '../api/use-attendance-actions-read';
import { attendancePages, type AttendanceRequestRow } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceActionPagination } from './attendance-action-pagination';
import { AttendanceActionsTable } from './attendance-actions-table';
import { attendanceRequestColumns } from './attendance-request-columns';
import { AttendanceRequestEditor } from './attendance-request-editor';
import type { RequestAction } from './attendance-request-row-actions';
export function AttendanceRequestsList({
  scope,
  status,
  timezone,
}: {
  scope: AttendanceBoardScope;
  status: AttendanceChangeListQuery['status'];
  timezone: string;
}) {
  const locale = useLocale();
  const [selection, setSelection] = useState<{
    row: AttendanceRequestRow;
    action: RequestAction;
  }>();
  const query = useAttendanceRequests(scope, status);
  const visible = !boardAccessLost(query.error);
  const items = visible ? attendancePages(query.data?.pages) : [];
  const current =
    selection &&
    items.find((row) => row.id === selection.row.id && row.revision === selection.row.revision);
  return (
    <>
      <AttendanceActionFeedback
        error={query.error}
        loading={query.isPending}
        onRetry={() => {
          void query.refetch();
        }}
      />
      {query.data && visible ? (
        <AttendanceActionsTable
          items={items}
          columns={attendanceRequestColumns(locale, timezone, (row, action) =>
            setSelection({ row, action }),
          )}
        />
      ) : null}
      <AttendanceActionPagination
        hasMore={query.hasNextPage && visible}
        fetching={query.isFetching}
        onMore={() => {
          void query.fetchNextPage();
        }}
      />
      {current && selection ? (
        <AttendanceRequestEditor
          scope={scope}
          row={current}
          action={selection.action}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </>
  );
}
