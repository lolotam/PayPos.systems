'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceStatementDownload } from '../api/use-attendance-statement-download';
import { useAttendanceStatementEmployeeSelection } from '../api/use-attendance-statement-employee-selection';
import {
  useAttendanceStatementRequest,
  type AttendanceStatementScope,
} from '../api/use-attendance-statement-request';
import { useAttendanceStatementShifts } from '../api/use-attendance-statement-shifts';
import { useAttendanceStatementStatus } from '../api/use-attendance-statement-status';
import {
  statementApplyPatch,
  statementCollectCanRecover,
  statementExpired,
  statementFormAccessLost,
  statementInitialDraft,
  statementPeriod,
  statementPeriodIsValid,
  statementRequestBody,
  type StatementDraft,
  type StatementDraftPatch,
  type StatementLanguage,
} from '../model/attendance-statement-display';
import { AttendanceStatementForm } from '../ui/attendance-statement-form';
import { AttendanceStatementProgress } from '../ui/attendance-statement-progress';

type Props = {
  scope: AttendanceStatementScope;
  branches: WorkspaceBranch[];
  timezone: string;
  onBranch: (branchId: string) => void;
};

async function checkStatementAgain(
  download: ReturnType<typeof useAttendanceStatementDownload>,
  status: ReturnType<typeof useAttendanceStatementStatus>,
  setCheckingAgain: (checking: boolean) => void,
) {
  setCheckingAgain(true);
  download.reset();
  try {
    await status.refetch();
  } finally {
    setCheckingAgain(false);
  }
}

type ResetStatementInput = {
  request: ReturnType<typeof useAttendanceStatementRequest>;
  download: ReturnType<typeof useAttendanceStatementDownload>;
  setDraft: Dispatch<SetStateAction<StatementDraft>>;
};

function resetStatement(input: ResetStatementInput, timezone: string, locale: StatementLanguage) {
  input.request.reset();
  input.download.reset();
  input.setDraft(statementInitialDraft(timezone, locale));
}

function statementShiftProps(shifts: ReturnType<typeof useAttendanceStatementShifts>) {
  return {
    shifts: shifts.data?.shifts ?? [],
    shiftsLoadFailed: Boolean(shifts.error),
    onRetryShifts: () => void shifts.refetch(),
  };
}

export function AttendanceStatementPage(props: Props) {
  const locale = useLocale();
  const [draft, setDraft] = useState(() => statementInitialDraft(props.timezone, locale));
  const [checkingAgain, setCheckingAgain] = useState(false);
  const request = useAttendanceStatementRequest(props.scope);
  const acceptedDraft = request.data ? request.variables?.draft : undefined;
  const renderId = request.data?.render_id;
  const period = statementPeriod(draft);
  const periodValid = statementPeriodIsValid(period, props.timezone);
  const shifts = useAttendanceStatementShifts(props.scope, period, periodValid);
  const employees = useAttendanceStatementEmployeeSelection(draft, setDraft, props);
  const status = useAttendanceStatementStatus(props.scope, renderId);
  const download = useAttendanceStatementDownload(props.scope, renderId, acceptedDraft);
  const change = (patch: StatementDraftPatch) =>
    setDraft((current) => statementApplyPatch(current, patch));
  const submit = () => request.mutate({ body: statementRequestBody(draft, period), draft });
  const reset = () => resetStatement({ request, download, setDraft }, props.timezone, locale);
  const renderFailure = status.error ?? download.error;
  const expired = statementExpired(status.error) || statementExpired(download.error);
  const collectRecovery = statementCollectCanRecover(download.error ?? status.error);
  if (statementFormAccessLost(shifts.error ?? employees.error, renderFailure, request.error)) {
    return <p role="alert">{t(locale, 'attendanceStatementScreen.noAccess')}</p>;
  }
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceStatementScreen.title')} />
      <AttendanceStatementForm
        branches={props.branches}
        branchId={props.scope.branchId}
        draft={draft}
        {...statementShiftProps(shifts)}
        employees={employees.data ?? []}
        employeesLoading={employees.isLoading}
        employeesError={employees.error}
        onEmployeesRetry={() => void employees.refetch()}
        periodValid={periodValid}
        locked={renderId !== undefined}
        submitting={request.isPending}
        onBranch={props.onBranch}
        onChange={change}
        onSubmit={submit}
      />
      <AttendanceStatementProgress
        state={checkingAgain ? undefined : status.data?.state}
        errorCode={status.data?.error_code}
        error={request.error ?? download.error ?? status.error}
        errorRoute={request.error ? 'request' : 'render'}
        waiting={renderId !== undefined}
        showCheckAgain={!expired && (collectRecovery || status.timedOut)}
        collected={download.isSuccess}
        downloading={download.isPending}
        showNewRequest={expired || collectRecovery}
        onDownload={() => download.mutate()}
        onCheckAgain={() => void checkStatementAgain(download, status, setCheckingAgain)}
        onNewRequest={reset}
      />
    </section>
  );
}
