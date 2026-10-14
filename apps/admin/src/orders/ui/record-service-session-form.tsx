'use client';
import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch, type UseFormReset } from 'react-hook-form';
import type { SessionServiceScope } from '../api/use-session-services';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { sessionResultFrozen } from '../model/session-recording-result';
import { reportSessionSubmitError } from '../model/session-submit-error';
import type { SessionRecordingController } from '../model/use-session-recording';
import { useLocale } from '@/shared/locale/locale-context';
import { SessionCustomerField } from './session-customer-field';
import { SessionDraftLines } from './session-draft-lines';
import { SessionRecordingHeader } from './session-recording-header';
import { SessionRejectedLines } from './session-rejected-lines';
import { SessionSavedResult } from './session-saved-result';
import { SessionTimeField } from './session-time-field';
import { SessionWriteFeedback } from './session-write-feedback';

function editorDrafts(drafts: SessionDraftForm): SessionDraftForm {
  return drafts.lines.length ? drafts : { ...drafts, lines: [createSessionDraft()] };
}

// بعد الحفظ الوقت المعتمد هو occurred_at اللي رجعه الخادم، حتى لو المسودة كانت «دلوقتي» من غير حقل.
function shownVisitTime(drafts: SessionDraftForm, savedAt: string | undefined): SessionDraftForm {
  const seeded = editorDrafts(drafts);
  if (savedAt === undefined || seeded.occurred_at === savedAt) return seeded;
  return { ...seeded, occurred_at: savedAt };
}

function useDraftReset(reset: UseFormReset<SessionDraftForm>, drafts: SessionDraftForm, savedAt: string | undefined) {
  const seen = useRef({ drafts, savedAt });
  useEffect(() => {
    if (seen.current.drafts === drafts && seen.current.savedAt === savedAt) return;
    seen.current = { drafts, savedAt };
    reset(shownVisitTime(drafts, savedAt));
  }, [drafts, reset, savedAt]);
}

function focusDraftPrice(localId: string) {
  document.getElementById(`${localId}-price`)?.focus();
}

export function RecordServiceSessionForm({ scope, context, online, recording, onRefreshScope }: {
  scope: SessionServiceScope; context: RecordingContext; online: boolean; recording: SessionRecordingController;
  onRefreshScope: () => void;
}) {
  const locale = useLocale();
  const { result, journal } = recording;
  const frozen = sessionResultFrozen(result);
  // أول حفظ بيثبّت رأس الزيارة (الزبونة والوقت والعضوية)؛ سطور التصحيح بس اللي تفضل مفتوحة.
  const locked = frozen || result.sessionId !== null;
  // زيارة PARTIAL مسترجعة بعد reload مش شايلة العضوية؛ القائمة تفضل مفتوحة لحد ما العضوية تتعرف، وإلا التصحيح يترفض
  // بـ SESSION_RECORDER_MEMBERSHIP_REQUIRED لمسجّلة عندها أكتر من عضوية.
  const membershipFixed = result.sessionId !== null && result.drafts.recorder_membership_id != null;
  const savedAt = result.session?.occurred_at;
  const [seed] = useState(() => shownVisitTime(result.drafts, savedAt));
  const form = useForm<SessionDraftForm>({ defaultValues: seed });
  const draftedAt = useWatch({ control: form.control, name: 'occurred_at' });
  const occurredAt = savedAt ?? draftedAt;
  useDraftReset(form.reset, result.drafts, savedAt);
  const rootError = form.formState.errors.root?.message;
  return <FormProvider {...form}>
    <form className="grid gap-4 text-start" noValidate onSubmit={form.handleSubmit(async (drafts) => {
      try { await recording.submit(drafts); } catch (error) { reportSessionSubmitError(form.setError, error, locale); }
    })}>
      <SessionCustomerField companyId={scope.companyId} branchId={scope.branchId} userId={scope.userId}
        value={result.customer} onChange={recording.selectCustomer} disabled={!online || locked} />
      <SessionTimeField context={context} disabled={locked} />
      <SessionRecordingHeader scope={scope} disabled={!online || frozen} readOnly={membershipFixed} />
      <SessionDraftLines scope={scope} {...(occurredAt !== undefined ? { occurredAt } : {})} disabled={!online || frozen} />
      <SessionRejectedLines result={result} onEdit={focusDraftPrice} />
      {rootError ? <p role="alert">{rootError}</p> : null}
      <SessionWriteFeedback result={result} onRefreshScope={onRefreshScope} {...(online ? { onReplay: () => { void recording.retry(); } } : {})} />
      <Button type="submit" disabled={!online || frozen || !journal || (!result.sessionId && !result.customer)}>
        {t(locale, result.sessionId ? 'serviceSessions.correctAndAppend' : 'serviceSessions.save')}
      </Button>
    </form>
    {journal ? <SessionSavedResult result={result} journal={journal} onNewVisit={recording.replaceResult} /> : null}
  </FormProvider>;
}
