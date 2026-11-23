'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { AttendanceRequestFilters } from '../ui/attendance-request-filters';
import { AttendanceRequestsList } from '../ui/attendance-requests-list';
import { AttendanceManualEditor } from '../ui/attendance-manual-editor';
import { useAttendanceRequestsAccess } from '../api/use-attendance-requests-access';
export function AttendanceRequestsPage({
  scope,
  branches,
  onBranch,
}: {
  scope: AttendanceBoardScope;
  branches: WorkspaceBranch[];
  onBranch: (id: string) => void;
}) {
  const locale = useLocale();
  const [status, setStatus] = useState<AttendanceChangeListQuery['status']>('PENDING');
  const [manual, setManual] = useState(false);
  const [view, setView] = useState<'all' | 'branch'>();
  const inboxAccess = useAttendanceRequestsAccess(scope);
  const allBranches = inboxAccess.canDecideAny && view !== 'branch';
  const timezone = branches.find((branch) => branch.id === scope.branchId)?.effective_timezone;
  const canCreate = Boolean(timezone) && inboxAccess.canRequest;
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'attendanceActions.requests')}
        action={
          canCreate ? (
            <Button onClick={() => setManual(true)}>{t(locale, 'attendanceActions.manual')}</Button>
          ) : undefined
        }
      />
      <AttendanceRequestsList
        scope={scope}
        status={status}
        branches={branches}
        timezone={timezone}
        allBranches={allBranches}
        enabled={!inboxAccess.isPending}
        filters={
          <AttendanceRequestFilters
            branches={branches}
            branchId={allBranches ? 'all' : scope.branchId}
            status={status}
            allowAllBranches={inboxAccess.canDecideAny}
            onBranch={(id) => {
              setManual(false);
              setView(id === 'all' ? 'all' : 'branch');
              if (id !== 'all') onBranch(id);
            }}
            onStatus={setStatus}
          />
        }
      />
      {manual && timezone && inboxAccess.canRequest ? (
        <AttendanceManualEditor
          scope={scope}
          timezone={timezone}
          branch={branches.find((branch) => branch.id === scope.branchId)}
          onClose={() => setManual(false)}
        />
      ) : null}
    </PageShell>
  );
}
