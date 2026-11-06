import { useState } from 'react';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeaveBranches } from '../api/use-my-leave';
import { leaveErrorText } from '../model/error-text';
import type { LeaveContext } from '../model/context';
import { LeavePanel } from './leave-panel';
import { LeaveSessionRecovery } from './leave-session-recovery';
import { LeaveBranchSelector } from './leave-branch-selector';
import { LeaveReadRetry } from './leave-read-retry';
import type { RecoverLeaveSession } from '../model/session-recovery';

interface BranchLeaveProps {
  context: LeaveContext;
  recoverSession: RecoverLeaveSession;
}

export function BranchLeave({ context, recoverSession }: BranchLeaveProps) {
  const locale = useLocale();
  const [sessionRefusal, setSessionRefusal] = useState<unknown>(null);
  const branches = useLeaveBranches(context, !sessionRefusal, setSessionRefusal);
  const [selected, setSelected] = useState('');
  if (sessionRefusal)
    return (
      <LeaveSessionRecovery
        context={context}
        recoverSession={recoverSession}
        branch={context.mode === 'reception' ? (context.branch_id ?? '') : selected}
        error={sessionRefusal}
        recovered={(eligible) => {
          setSelected(eligible);
          branches.clearRefusalAfterRecovery();
          setSessionRefusal(null);
        }}
      />
    );
  if (context.mode === 'reception')
    return (
      <LeavePanel
        context={context}
        branch={context.branch_id ?? ''}
        timezone={context.timezone}
        sessionRefused={setSessionRefusal}
      />
    );
  if (branches.isPending && !branches.refusal)
    return <p role="status">{t(locale, 'pos.loading')}</p>;
  if (branches.refusal || (branches.isError && branches.data === undefined))
    return (
      <LeaveReadRetry
        error={branches.refusal ?? branches.error}
        retry={branches.retry}
        busy={branches.isFetching}
      />
    );
  const items = branches.data?.items ?? [];
  if (items.length === 0) return <p>{t(locale, 'myLeave.noBranches')}</p>;
  const branch = items.some((item) => item.id === selected) ? selected : '';
  return (
    <>
      {branches.isError ? <p role="alert">{leaveErrorText(branches.error, locale)}</p> : null}
      <LeaveBranchSelector items={items} selected={branch} select={setSelected} />
      {branch ? (
        <LeavePanel
          key={branch}
          context={context}
          branch={branch}
          timezone={items.find((item) => item.id === branch)?.timezone}
          sessionRefused={setSessionRefusal}
        />
      ) : null}
    </>
  );
}
