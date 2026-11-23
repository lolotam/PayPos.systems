'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { useAttendanceExceptions } from '../api/use-attendance-actions-read';
import { attendancePages } from '../model/attendance-action-display';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceExceptionFilters } from '../ui/attendance-exception-filters';
import { AttendanceActionCard } from '../ui/attendance-action-card';
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
    <PageShell layout="list">
      <PageHeader title={t(locale, 'attendanceActions.exceptions')} />
      <AttendanceActionCard
        query={query}
        tableReady={Boolean(timezone)}
        items={items}
        columns={timezone ? attendanceExceptionColumns(locale, timezone, setSelection) : []}
        filters={
          <AttendanceExceptionFilters
            branches={branches}
            branchId={scope.branchId}
            status={status}
            onBranch={onBranch}
            onStatus={(next) => {
              setSelection(undefined);
              setStatus(next);
            }}
          />
        }
      />
      {selection &&
      items.some(
        (row) => row.id === selection.id && row.revision === selection.revision && row.can_resolve,
      ) &&
      !boardAccessLost(query.error) ? (
        <AttendanceExceptionEditor
          scope={scope}
          row={selection}
          onClose={() => setSelection(undefined)}
        />
      ) : null}
    </PageShell>
  );
}
