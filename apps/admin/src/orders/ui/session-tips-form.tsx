'use client';
import type { SessionTips } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { RefObject } from 'react';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import type { TipSourceLine } from '../model/session-tip-source';
import { SessionTipsActions } from './session-tips-actions';
import { SessionTipsMembership } from './session-tips-membership';
import { SessionTipsReason } from './session-tips-reason';
import { SessionTipsRows } from './session-tips-rows';
import { SessionTipsSuggestion } from './session-tips-suggestion';
import { useSessionTipsForm } from './use-session-tips-form';

export function SessionTipsForm(props: {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  loaded: SessionTips;
  memory: RefObject<Map<string, UnresolvedTip>>;
  reload: () => Promise<SessionTips | null>;
  onAccessDenied: (message: string) => void;
  onClose: () => void;
}) {
  const state = useSessionTipsForm(props);
  const amountError = state.form.formState.errors.root
    ? t(state.locale, 'sessionTips.amountInvalid')
    : null;
  const locked = state.frozen || state.blocked;
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
        pending={state.pending || (state.blocked && !state.conflictHold)}
        blocked={state.blocked}
        conflictHold={state.conflictHold}
        onClose={props.onClose}
        onRetry={state.retry}
      />
    </form>
  );
}
