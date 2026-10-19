'use client';
import type { SessionTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useEffect, type RefObject } from 'react';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsActions } from './session-tips-actions';
import { SessionTipsMembership } from './session-tips-membership';
import { SessionTipsReason } from './session-tips-reason';
import { SessionTipsRows } from './session-tips-rows';
import { SessionTipsSuggestion } from './session-tips-suggestion';
import { useSessionTipsForm } from './use-session-tips-form';

type SessionTipsFormViewProps = {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  loaded: SessionTips;
  memory: RefObject<Map<string, UnresolvedTip>>;
  reload: () => Promise<SessionTips | null>;
  netsKnown?: boolean;
  onBusy: (busy: boolean) => void;
  onAccessDenied: (message: string) => void;
  onForbidden: (message: string) => void;
  onClose: () => void;
};

function invalidAmount(message: string | undefined): boolean {
  return message === 'amount' || message === 'rejected';
}

function useReportTipBusy(busy: boolean, onBusy: (busy: boolean) => void) {
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
}

export function SessionTipsForm(props: SessionTipsFormViewProps) {
  const state = useSessionTipsForm(props);
  const amountError = invalidAmount(state.form.formState.errors.root?.message)
    ? t(state.locale, 'sessionTips.amountInvalid')
    : null;
  const locked = state.frozen || state.blocked;
  const quietHold = state.pending || (state.blocked && !state.holding);
  useReportTipBusy(quietHold, props.onBusy);
  return (
    <form className="grid gap-3 text-start" onSubmit={state.onSubmit}>
      {state.notice ? <p role="alert">{state.notice}</p> : null}
      {state.uncertain ? <p>{t(state.locale, 'sessionTips.outcomeUnknown')}</p> : null}
      {amountError ? <p role="alert">{amountError}</p> : null}
      <SessionTipsSuggestion
        form={state.form}
        locale={state.locale}
        lines={props.lines}
        locked={locked}
        exact={state.uncertain}
        netsKnown={props.netsKnown ?? true}
      />
      <SessionTipsRows
        form={state.form}
        locale={state.locale}
        lines={props.lines}
        locked={locked}
      />
      <SessionTipsReason form={state.form} locale={state.locale} locked={locked} />
      <SessionTipsMembership
        form={state.form}
        locale={state.locale}
        companyId={props.scope.companyId}
        userId={props.scope.userId}
        memberships={state.memberships}
        locked={locked}
      />
      <SessionTipsActions
        locale={state.locale}
        online={props.online}
        pending={quietHold}
        blocked={state.blocked}
        conflictHold={state.conflictHold}
        reloadHold={state.reloadHold}
        uncertain={state.uncertain}
        onClose={props.onClose}
        onRetry={state.retry}
        onReload={state.reloadCurrent}
        onReplay={state.replay}
      />
    </form>
  );
}
