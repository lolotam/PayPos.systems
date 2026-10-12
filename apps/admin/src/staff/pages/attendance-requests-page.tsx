'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { AttendanceRequestFilters } from '../ui/attendance-request-filters';
import { AttendanceRequestsList } from '../ui/attendance-requests-list';
import { AttendanceManualEditor } from '../ui/attendance-manual-editor';
import { useAttendanceCapabilities } from '../api/use-attendance-capabilities';
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
  const capabilityQuery = useAttendanceCapabilities(scope);
  const { capabilities } = capabilityQuery;
  const allBranches = capabilities.decide && view !== 'branch';
  const timezone = branches.find((branch) => branch.id === scope.branchId)?.effective_timezone;
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceActions.requests')} />
      <AttendanceRequestFilters
        branches={branches}
        branchId={allBranches ? 'all' : scope.branchId}
        status={status}
        canCreate={Boolean(timezone) && capabilities.request_change}
        allowAllBranches={capabilities.decide}
        onBranch={(id) => {
          setManual(false);
          setView(id === 'all' ? 'all' : 'branch');
          if (id !== 'all') onBranch(id);
        }}
        onStatus={setStatus}
        onManual={() => setManual(true)}
      />
      {timezone ? (
        <AttendanceRequestsList
          scope={scope}
          status={status}
          branches={branches}
          timezone={timezone}
          allBranches={allBranches}
          enabled={!capabilityQuery.isPending}
        />
      ) : null}
      {manual && timezone && capabilities.request_change ? (
        <AttendanceManualEditor
          scope={scope}
          timezone={timezone}
          branch={branches.find((branch) => branch.id === scope.branchId)}
          onClose={() => setManual(false)}
        />
      ) : null}
    </section>
  );
}
