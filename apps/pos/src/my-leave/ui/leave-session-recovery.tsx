import { useEffect, useRef, useState } from 'react';
import { Button } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { recoverLeaveSession } from '../api/recover-leave-session';
import type { LeaveContext } from '../model/context';
import { leaveErrorText } from '../model/error-text';

export function LeaveSessionRecovery({
  context,
  branch,
  error,
  recovered,
}: {
  context: LeaveContext;
  branch: string;
  error: unknown;
  recovered: (branch: string) => void;
}) {
  const locale = useLocale();
  const [failure, setFailure] = useState(error);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  const retry = async () => {
    if (attempt.current && !attempt.current.signal.aborted) return;
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(true);
    try {
      const eligibleBranch = await recoverLeaveSession(context, branch, controller.signal);
      if (!controller.signal.aborted) recovered(eligibleBranch);
    } catch (refusal) {
      if (!controller.signal.aborted) setFailure(refusal);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      controller.abort();
    }
  };
  return (
    <div>
      <p role="alert">{leaveErrorText(failure, locale)}</p>
      <Button
        disabled={busy}
        onClick={() => {
          void retry();
        }}
      >
        {t(locale, 'myLeave.retry')}
      </Button>
    </div>
  );
}
