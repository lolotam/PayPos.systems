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
  const timezone = branches.find((branch) => branch.id === scope.branchId)?.effective_timezone;
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceActions.requests')} />
      <AttendanceRequestFilters
        branches={branches}
        branchId={scope.branchId}
        status={status}
        canCreate={Boolean(timezone)}
        onBranch={onBranch}
        onStatus={setStatus}
        onManual={() => setManual(true)}
      />
      {timezone ? (
        <AttendanceRequestsList scope={scope} status={status} timezone={timezone} />
      ) : null}
      {manual && timezone ? (
        <AttendanceManualEditor
          scope={scope}
          timezone={timezone}
          onClose={() => setManual(false)}
        />
      ) : null}
    </section>
  );
}
