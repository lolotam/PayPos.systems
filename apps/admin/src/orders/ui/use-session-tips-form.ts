'use client';
import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useRef, useState, type FormEvent, type RefObject } from 'react';
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
import { commitSessionTips, type TipSaveResult } from '../model/session-tips-save';
import type { TipSourceLine } from '../model/session-tip-source';

type SaveControls = {
  locale: Locale;
  sessionId: string;
  lines: readonly TipSourceLine[];
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  retain: { current: RecordSessionTipsInput | null };
  setNotice: (value: string | null) => void;
  setUncertain: (value: boolean) => void;
  setFrozen: (value: boolean) => void;
  setRefreshing: (value: boolean) => void;
  setConflictHold: (value: boolean) => void;
  setMemberships: (ids: string[]) => void;
  onAccessDenied: (message: string) => void;
  onClose: () => void;
};

function applySaveResult(controls: SaveControls, result: TipSaveResult) {
  if (result.kind === 'saved') {
    controls.retain.current = null;
    controls.form.reset(tipFormValues(result.tips, controls.lines));
    controls.setFrozen(false);
    controls.setUncertain(false);
    controls.setConflictHold(false);
    controls.setNotice(t(controls.locale, 'sessionTips.saved'));
    return;
  }
  if (result.kind === 'unknown') {
    controls.setUncertain(true);
    controls.setNotice(result.message);
    return;
  }
  controls.retain.current = null;
  controls.setFrozen(false);
  controls.setUncertain(false);
  finishKnownSave(controls, result);
}

function finishKnownSave(
  controls: SaveControls,
  result: Exclude<TipSaveResult, { kind: 'saved' | 'unknown' }>,
) {
  if (result.kind === 'revoked') {
    controls.onAccessDenied(result.message);
    controls.onClose();
    return;
  }
  controls.setNotice(result.message);
  if (result.kind === 'conflict') {
    if (!result.tips) {
      controls.setConflictHold(true);
      return;
    }
    controls.form.reset(tipFormValues(result.tips, controls.lines));
    controls.setConflictHold(false);
    return;
  }
  if (result.memberships) controls.setMemberships(result.memberships);
}

async function adoptReplayedTips(
  controls: SaveControls,
  replayed: SessionTips,
  reload: () => Promise<SessionTips | null>,
): Promise<boolean> {
  controls.setRefreshing(true);
  try {
    const current = await reload();
    // إعادة المفتاح بترجع المراجعة الأصلية؛ لو القراءة أحدث نعرضها قبل ما الفورم يتصفّر.
    if (!current || current.revision < replayed.revision) return false;
    applySaveResult(controls, { kind: 'saved', tips: current });
    return true;
  } finally {
    controls.setRefreshing(false);
  }
}

async function runSave(
  controls: SaveControls,
  body: RecordSessionTipsInput,
  mutate: (body: RecordSessionTipsInput) => Promise<SessionTips>,
  reload: () => Promise<SessionTips | null>,
  replaying: boolean,
) {
  controls.setNotice(null);
  controls.setFrozen(true);
  controls.retain.current = body;
  const result = await commitSessionTips({
    locale: controls.locale,
    mutate: () => mutate(body),
    reload: async () => {
      controls.setRefreshing(true);
      try {
        return await reload();
      } finally {
        controls.setRefreshing(false);
      }
    },
  });
  if (
    result.kind === 'saved' &&
    replaying &&
    (await adoptReplayedTips(controls, result.tips, reload))
  ) {
    return;
  }
  applySaveResult(controls, result);
}

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
  onClose: () => void;
};

function useTipFlags(restored: UnresolvedTip | null): TipFlags {
  const chosen = restored?.body.recorder_membership_id;
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(restored !== null);
  const [frozen, setFrozen] = useState(restored !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [conflictHold, setConflictHold] = useState(false);
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
    setMemberships: flags.setMemberships,
    onAccessDenied: props.onAccessDenied,
    onClose: props.onClose,
  };
}

function submitTips(
  controls: SaveControls,
  online: boolean,
  blocked: boolean,
  uncertain: boolean,
  mutate: (body: RecordSessionTipsInput) => Promise<SessionTips>,
  reload: () => Promise<SessionTips | null>,
) {
  const send = (body: RecordSessionTipsInput, replaying: boolean) => {
    if (!online || blocked) return;
    void runSave(controls, body, mutate, reload, replaying);
  };
  return (event: FormEvent<HTMLFormElement>) => {
    const replay = controls.retain.current;
    if (replay && uncertain) {
      event.preventDefault();
      send(replay, true);
      return;
    }
    void controls.form.handleSubmit((body) => {
      send(body, false);
    })(event);
  };
}

function replayHeld(
  controls: SaveControls,
  online: boolean,
  blocked: boolean,
  mutate: (body: RecordSessionTipsInput) => Promise<SessionTips>,
  reload: () => Promise<SessionTips | null>,
) {
  const body = controls.retain.current;
  if (!body || !online || blocked) return;
  void runSave(controls, body, mutate, reload, true);
}

async function retryTips(
  flags: TipFlags,
  pending: boolean,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  lines: readonly TipSourceLine[],
  reload: () => Promise<SessionTips | null>,
) {
  if (pending || flags.refreshing) return;
  flags.setRefreshing(true);
  try {
    const tips = await reload();
    if (!tips) return;
    form.reset(tipFormValues(tips, lines));
    flags.setConflictHold(false);
  } finally {
    flags.setRefreshing(false);
  }
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
  const blocked = pending || flags.refreshing || flags.conflictHold;
  const controls = controlsFor(props, locale, form, retain, flags);
  const mutate = (body: RecordSessionTipsInput) =>
    mutation.mutateAsync({ sessionId: props.sessionId, body });
  const onSubmit = submitTips(
    controls,
    props.online,
    blocked,
    flags.uncertain,
    mutate,
    props.reload,
  );
  const replay = () => {
    replayHeld(controls, props.online, blocked, mutate, props.reload);
  };
  const retry = () => {
    void retryTips(flags, pending, form, props.lines, props.reload);
  };
  return {
    locale,
    form,
    notice: flags.notice,
    uncertain: flags.uncertain,
    frozen: flags.frozen,
    blocked,
    pending,
    conflictHold: flags.conflictHold,
    memberships: flags.memberships,
    onSubmit,
    retry,
    replay,
  };
}
