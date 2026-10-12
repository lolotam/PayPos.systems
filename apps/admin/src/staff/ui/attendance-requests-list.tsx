'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { useMemo, useState } from 'react';
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
type Props = {
  scope: AttendanceBoardScope;
  status: AttendanceChangeListQuery['status'];
  timezone: string;
  branches: WorkspaceBranch[];
  allBranches: boolean;
  enabled: boolean;
};
export function AttendanceRequestsList({
  scope,
  status,
  timezone,
  branches,
  allBranches,
  enabled,
}: Props) {
  const locale = useLocale();
  const [selection, setSelection] = useState<{
    row: AttendanceRequestRow;
    action: RequestAction;
  }>();
  const query = useAttendanceRequests(scope, status, allBranches, enabled);
  const columns = useMemo(
    () =>
      attendanceRequestColumns(locale, timezone, scope, branches, (row, action) =>
        setSelection({ row, action }),
      ),
    [locale, timezone, scope, branches],
  );
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
      {query.data && visible ? <AttendanceActionsTable items={items} columns={columns} /> : null}
      <AttendanceActionPagination
        hasMore={query.hasNextPage && visible}
        fetching={query.isFetching}
        onMore={() => {
          void query.fetchNextPage();
        }}
      />
      {current && selection ? (
        <AttendanceRequestEditor
          scope={{ ...scope, branchId: current.branch_id }}
          row={current}
          action={selection.action}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </>
  );
}
