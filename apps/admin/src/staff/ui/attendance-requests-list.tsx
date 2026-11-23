'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceRequests } from '../api/use-attendance-actions-read';
import { useAttendanceRequestsLifetime } from '../api/use-attendance-requests-lifetime';
import { attendancePages, type AttendanceRequestRow } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceActionCard } from './attendance-action-card';
import { attendanceRequestColumns } from './attendance-request-columns';
import { AttendanceRequestEditor } from './attendance-request-editor';
import type { RequestAction } from './attendance-request-row-actions';
type Props = {
  scope: AttendanceBoardScope;
  status: AttendanceChangeListQuery['status'];
  /** غائبة حين لا يوجد فرع بمنطقة زمنية: الكرت يبقى بتصفيته، بلا استعلام ولا صفوف. */
  timezone: string | undefined;
  branches: WorkspaceBranch[];
  allBranches: boolean;
  enabled: boolean;
  filters: ReactNode;
};
export function AttendanceRequestsList({
  scope,
  status,
  timezone,
  branches,
  allBranches,
  enabled,
  filters,
}: Props) {
  const locale = useLocale();
  const [selection, setSelection] = useState<{
    row: AttendanceRequestRow;
    action: RequestAction;
  }>();
  const clearSelection = useCallback(() => setSelection(undefined), []);
  useAttendanceRequestsLifetime(scope, Boolean(timezone), clearSelection);
  const query = useAttendanceRequests(scope, status, allBranches, enabled && Boolean(timezone));
  const columns = useMemo(
    () =>
      timezone
        ? attendanceRequestColumns(locale, timezone, scope, branches, (row, action) =>
            setSelection({ row, action }),
          )
        : [],
    [locale, timezone, scope, branches],
  );
  const visible = !boardAccessLost(query.error);
  const items = visible ? attendancePages(query.data?.pages) : [];
  const current =
    timezone &&
    selection &&
    items.find((row) => row.id === selection.row.id && row.revision === selection.row.revision);
  return (
    <>
      <AttendanceActionCard
        query={query}
        listed={Boolean(timezone)}
        items={items}
        columns={columns}
        filters={filters}
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
