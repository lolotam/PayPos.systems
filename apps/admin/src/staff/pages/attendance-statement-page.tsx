'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceStatementDownload } from '../api/use-attendance-statement-download';
import { useAttendanceStatementEmployees } from '../api/use-attendance-statement-employees';
import {
  useAttendanceStatementRequest,
  type AttendanceStatementScope,
} from '../api/use-attendance-statement-request';
import { useAttendanceStatementShifts } from '../api/use-attendance-statement-shifts';
import { useAttendanceStatementStatus } from '../api/use-attendance-statement-status';
import {
  statementApplyPatch,
  statementExpired,
  statementFormAccessLost,
  statementInitialDraft,
  statementPeriod,
  statementPeriodIsValid,
  statementRequestBody,
  type StatementDraftPatch,
} from '../model/attendance-statement-display';
import { AttendanceStatementForm } from '../ui/attendance-statement-form';
import { AttendanceStatementProgress } from '../ui/attendance-statement-progress';

type Props = {
  scope: AttendanceStatementScope;
  branches: WorkspaceBranch[];
  timezone: string;
  onBranch: (branchId: string) => void;
};

export function AttendanceStatementPage(props: Props) {
  const locale = useLocale();
  const [draft, setDraft] = useState(() => statementInitialDraft(props.timezone, locale));
  const request = useAttendanceStatementRequest(props.scope);
  const renderId = request.data?.render_id;
  const period = statementPeriod(draft);
  const periodValid = statementPeriodIsValid(period, props.timezone);
  const shifts = useAttendanceStatementShifts(props.scope, period, periodValid);
  const employees = useAttendanceStatementEmployees(props.scope, period, periodValid);
  const status = useAttendanceStatementStatus(props.scope, renderId);
  const download = useAttendanceStatementDownload(props.scope, renderId, draft);
  const change = (patch: StatementDraftPatch) =>
    setDraft((current) => statementApplyPatch(current, patch));
  const submit = () => request.mutate(statementRequestBody(draft, period));
  const reset = () => {
    request.reset();
    download.reset();
    setDraft(statementInitialDraft(props.timezone, locale));
  };
  const renderFailure = status.error ?? download.error;
  if (statementFormAccessLost(shifts.error ?? employees.error, renderFailure)) {
    return <p role="alert">{t(locale, 'attendanceStatementScreen.noAccess')}</p>;
  }
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceStatementScreen.title')} />
      <AttendanceStatementForm
        branches={props.branches}
        branchId={props.scope.branchId}
        draft={draft}
        shifts={shifts.data?.shifts ?? []}
        employees={employees.data ?? []}
        employeesLoading={employees.isLoading}
        periodValid={periodValid}
        locked={renderId !== undefined}
        submitting={request.isPending}
        onBranch={props.onBranch}
        onChange={change}
        onSubmit={submit}
      />
      <AttendanceStatementProgress
        state={status.data?.state}
        errorCode={status.data?.error_code}
        error={request.error ?? download.error ?? status.error}
        errorRoute={request.error ? 'request' : 'render'}
        waiting={renderId !== undefined}
        timedOut={status.timedOut}
        collected={download.isSuccess}
        downloading={download.isPending}
        showNewRequest={statementExpired(request.error) || statementExpired(download.error)}
        onDownload={() => download.mutate()}
        onCheckAgain={() => void status.refetch()}
        onNewRequest={reset}
      />
    </section>
  );
}
