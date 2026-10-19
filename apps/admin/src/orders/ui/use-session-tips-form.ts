'use client';
import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { useRef, useState, type RefObject } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useRecordSessionTips, type UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import {
  resolveSessionTips,
  tipFormFromBody,
  tipFormValues,
  type SessionTipFormInput,
} from '../model/session-tip-body';
import type { TipSourceLine } from '../model/session-tip-source';
import {
  replayHeld,
  reloadCurrentTips,
  retryTips,
  submitTips,
  type SaveControls,
} from './session-tips-save-flow';

type TipFlags = {
  notice: string | null;
  setNotice: (value: string | null) => void;
  uncertain: boolean;
  setUncertain: (value: boolean) => void;
  frozen: boolean;
  setFrozen: (value: boolean) => void;
  refreshing: boolean;
  setRefreshing: (value: boolean) => void;
  conflictHold: boolean;
  setConflictHold: (value: boolean) => void;
  reloadHold: boolean;
  setReloadHold: (value: boolean) => void;
  memberships: string[];
  setMemberships: (ids: string[]) => void;
};

type SessionTipsFormProps = {
  scope: SessionServiceScope;
  sessionId: string;
  lines: readonly TipSourceLine[];
  online: boolean;
  loaded: SessionTips;
  memory: RefObject<Map<string, UnresolvedTip>>;
  reload: () => Promise<SessionTips | null>;
  onAccessDenied: (message: string) => void;
  onForbidden: (message: string) => void;
  onClose: () => void;
};

function useTipFlags(restored: UnresolvedTip | null): TipFlags {
  const chosen = restored?.body.recorder_membership_id;
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(restored !== null);
  const [frozen, setFrozen] = useState(restored !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [conflictHold, setConflictHold] = useState(false);
  const [reloadHold, setReloadHold] = useState(false);
  const [memberships, setMemberships] = useState<string[]>(chosen ? [chosen] : []);
  return {
    notice,
    setNotice,
    uncertain,
    setUncertain,
    frozen,
    setFrozen,
    refreshing,
    setRefreshing,
    conflictHold,
    setConflictHold,
    reloadHold,
    setReloadHold,
    memberships,
    setMemberships,
  };
}

function controlsFor(
  props: SessionTipsFormProps,
  locale: Locale,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  retain: { current: RecordSessionTipsInput | null },
  flags: TipFlags,
): SaveControls {
  return {
    locale,
    sessionId: props.sessionId,
    lines: props.lines,
    form,
    retain,
    setNotice: flags.setNotice,
    setUncertain: flags.setUncertain,
    setFrozen: flags.setFrozen,
    setRefreshing: flags.setRefreshing,
    setConflictHold: flags.setConflictHold,
    setReloadHold: flags.setReloadHold,
    setMemberships: flags.setMemberships,
    onAccessDenied: props.onAccessDenied,
    onForbidden: props.onForbidden,
    onClose: props.onClose,
  };
}

function releaseReload(flags: TipFlags) {
  flags.setReloadHold(false);
  flags.setFrozen(false);
  flags.setUncertain(false);
  flags.setNotice(null);
}

function tipFormActions(
  controls: SaveControls,
  flags: TipFlags,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  lines: readonly TipSourceLine[],
  online: boolean,
  pending: boolean,
  blocked: boolean,
  mutate: (body: RecordSessionTipsInput) => Promise<SessionTips>,
  reload: () => Promise<SessionTips | null>,
) {
  return {
    onSubmit: submitTips(controls, online, blocked, flags.uncertain, mutate, reload),
    replay: () => {
      replayHeld(controls, online, blocked, mutate, reload);
    },
    retry: () => {
      void retryTips(
        flags.refreshing,
        flags.setRefreshing,
        flags.setConflictHold,
        pending,
        form,
        lines,
        reload,
      );
    },
    reloadCurrent: () => {
      void reloadCurrentTips(
        flags.refreshing,
        flags.setRefreshing,
        () => {
          releaseReload(flags);
        },
        pending,
        form,
        lines,
        reload,
      );
    },
  };
}

export function useSessionTipsForm(props: SessionTipsFormProps) {
  const locale = useLocale();
  const mutation = useRecordSessionTips(props.scope, props.memory);
  const restored = props.memory.current?.get(props.sessionId) ?? null;
  const flags = useTipFlags(restored);
  const retain = useRef<RecordSessionTipsInput | null>(restored?.body ?? null);
  const form = useForm<SessionTipFormInput, unknown, RecordSessionTipsInput>({
    resolver: resolveSessionTips,
    defaultValues: restored
      ? tipFormFromBody(restored.body)
      : tipFormValues(props.loaded, props.lines),
  });
  const pending = mutation.isPending;
  const holding = flags.conflictHold || flags.reloadHold;
  const blocked = pending || flags.refreshing || holding;
  const controls = controlsFor(props, locale, form, retain, flags);
  const mutate = (body: RecordSessionTipsInput) =>
    mutation.mutateAsync({ sessionId: props.sessionId, body });
  const actions = tipFormActions(
    controls,
    flags,
    form,
    props.lines,
    props.online,
    pending,
    blocked,
    mutate,
    props.reload,
  );
  return {
    locale,
    form,
    notice: flags.notice,
    uncertain: flags.uncertain,
    frozen: flags.frozen,
    blocked,
    pending,
    holding,
    conflictHold: flags.conflictHold,
    reloadHold: flags.reloadHold,
    memberships: flags.memberships,
    ...actions,
  };
}
