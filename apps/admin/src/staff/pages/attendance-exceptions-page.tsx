'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceExceptions } from '../api/use-attendance-actions-read';
import { attendancePages } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceExceptionTabs } from '../ui/attendance-exception-tabs';
import { AttendanceActionPagination } from '../ui/attendance-action-pagination';
import { AttendanceActionBranch } from '../ui/attendance-action-branch';
import { AttendanceActionFeedback } from '../ui/attendance-action-feedback';
import { AttendanceActionsTable } from '../ui/attendance-actions-table';
import { attendanceExceptionColumns, type ExceptionRow } from '../ui/attendance-exception-columns';
import { AttendanceExceptionEditor } from '../ui/attendance-exception-editor';
export function AttendanceExceptionsPage({
  scope,
  branches,
  onBranch,
}: {
  scope: AttendanceBoardScope;
  branches: WorkspaceBranch[];
  onBranch: (id: string) => void;
}) {
  const locale = useLocale();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [selection, setSelection] = useState<ExceptionRow>();
  const query = useAttendanceExceptions(scope, status);
  const timezone = branches.find((branch) => branch.id === scope.branchId)?.effective_timezone;
  const items = boardAccessLost(query.error) ? [] : attendancePages(query.data?.pages);
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceActions.exceptions')} />
      <AttendanceActionBranch branches={branches} branchId={scope.branchId} onBranch={onBranch} />
      <AttendanceExceptionTabs
        status={status}
        onStatus={(next) => {
          setSelection(undefined);
          setStatus(next);
        }}
      />
      <AttendanceActionFeedback
        error={query.error}
        loading={query.isPending}
        onRetry={() => {
          void query.refetch();
        }}
      />
      {timezone && query.data && !boardAccessLost(query.error) ? (
        <AttendanceActionsTable
          items={items}
          columns={attendanceExceptionColumns(locale, timezone, setSelection)}
        />
      ) : null}
      <AttendanceActionPagination
        hasMore={query.hasNextPage && !boardAccessLost(query.error)}
        fetching={query.isFetching}
        onMore={() => {
          void query.fetchNextPage();
        }}
      />
      {selection && !boardAccessLost(query.error) ? (
        <AttendanceExceptionEditor
          scope={scope}
          row={selection}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </section>
  );
}
