import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import type { FormEvent } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { tipFormValues, type SessionTipFormInput } from '../model/session-tip-body';
import { commitSessionTips, type TipSaveResult } from '../model/session-tips-save';
import type { TipSourceLine } from '../model/session-tip-source';

type ReplayAdoption = 'shown' | 'stale' | 'unavailable';

export type SaveControls = {
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
  setReloadHold: (value: boolean) => void;
  setMemberships: (ids: string[]) => void;
  onAccessDenied: (message: string) => void;
  onForbidden: (message: string) => void;
  onClose: () => void;
};

function keptTipForm(controls: SaveControls, tips: SessionTips): SessionTipFormInput {
  return tipFormValues(tips, controls.lines, controls.form.getValues('recorder_membership_id'));
}

export function applySaveResult(controls: SaveControls, result: TipSaveResult) {
  if (result.kind === 'saved') {
    controls.retain.current = null;
    controls.form.reset(keptTipForm(controls, result.tips));
    controls.setFrozen(false);
    controls.setUncertain(false);
    controls.setConflictHold(false);
    controls.setReloadHold(false);
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
  if (result.kind === 'forbidden') {
    controls.onForbidden(result.message);
    controls.onClose();
    return;
  }
  controls.setNotice(result.message);
  if (result.kind === 'conflict') {
    if (!result.tips) {
      controls.setConflictHold(true);
      return;
    }
    controls.form.reset(keptTipForm(controls, result.tips));
    controls.setConflictHold(false);
    return;
  }
  if (result.memberships) controls.setMemberships(result.memberships);
}

async function adoptReplayedTips(
  controls: SaveControls,
  replayed: SessionTips,
  reload: () => Promise<SessionTips | null>,
): Promise<ReplayAdoption> {
  controls.setRefreshing(true);
  try {
    const current = await reload();
    // إعادة المفتاح بترجع المراجعة الأصلية. فشل إعادة القراءة ما يعرضش الرد القديم كأنه الحفظ الحالي.
    if (!current) return 'unavailable';
    if (current.revision < replayed.revision) return 'stale';
    applySaveResult(controls, { kind: 'saved', tips: current });
    return 'shown';
  } finally {
    controls.setRefreshing(false);
  }
}

function holdReplayReload(controls: SaveControls) {
  controls.setFrozen(true);
  controls.setUncertain(false);
  controls.setReloadHold(true);
  controls.setNotice(null);
}

export async function runSave(
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
  if (result.kind === 'saved' && replaying) {
    const adopted = await adoptReplayedTips(controls, result.tips, reload);
    if (adopted === 'shown') return;
    if (adopted === 'unavailable') {
      holdReplayReload(controls);
      return;
    }
  }
  applySaveResult(controls, result);
}

export function submitTips(
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

export function replayHeld(
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

async function replaceFromReload(
  refreshing: boolean,
  setRefreshing: (value: boolean) => void,
  pending: boolean,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  lines: readonly TipSourceLine[],
  reload: () => Promise<SessionTips | null>,
): Promise<SessionTips | null> {
  if (pending || refreshing) return null;
  setRefreshing(true);
  try {
    const tips = await reload();
    if (!tips) return null;
    form.reset(tipFormValues(tips, lines, form.getValues('recorder_membership_id')));
    return tips;
  } finally {
    setRefreshing(false);
  }
}

export async function retryTips(
  refreshing: boolean,
  setRefreshing: (value: boolean) => void,
  setConflictHold: (value: boolean) => void,
  pending: boolean,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  lines: readonly TipSourceLine[],
  reload: () => Promise<SessionTips | null>,
) {
  const tips = await replaceFromReload(refreshing, setRefreshing, pending, form, lines, reload);
  if (tips) setConflictHold(false);
}

export async function reloadCurrentTips(
  refreshing: boolean,
  setRefreshing: (value: boolean) => void,
  release: () => void,
  pending: boolean,
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>,
  lines: readonly TipSourceLine[],
  reload: () => Promise<SessionTips | null>,
) {
  const tips = await replaceFromReload(refreshing, setRefreshing, pending, form, lines, reload);
  if (!tips) return;
  release();
}
