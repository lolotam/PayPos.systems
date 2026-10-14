'use client';
import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useWatch, type UseFormReset } from 'react-hook-form';
import type { SessionServiceScope } from '../api/use-session-services';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { sessionResultFrozen } from '../model/session-recording-result';
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

function useDraftReset(reset: UseFormReset<SessionDraftForm>, drafts: SessionDraftForm) {
  const seen = useRef(drafts);
  useEffect(() => {
    if (seen.current === drafts) return;
    seen.current = drafts;
    reset(editorDrafts(drafts));
  }, [drafts, reset]);
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
  const [seed] = useState(() => editorDrafts(result.drafts));
  const form = useForm<SessionDraftForm>({ defaultValues: seed });
  const occurredAt = useWatch({ control: form.control, name: 'occurred_at' });
  useDraftReset(form.reset, result.drafts);
  return <FormProvider {...form}>
    <form className="grid gap-4 text-start" noValidate onSubmit={form.handleSubmit((drafts) => { void recording.submit(drafts); })}>
      <SessionCustomerField companyId={scope.companyId} branchId={scope.branchId} userId={scope.userId}
        value={result.customer} onChange={recording.selectCustomer} disabled={!online || locked} />
      <SessionTimeField context={context} disabled={locked} />
      <SessionRecordingHeader scope={scope} disabled={!online || frozen} readOnly={result.sessionId !== null} />
      <SessionDraftLines scope={scope} {...(occurredAt !== undefined ? { occurredAt } : {})} disabled={!online || frozen} />
      <SessionRejectedLines result={result} onEdit={focusDraftPrice} />
      <SessionWriteFeedback result={result} onRefreshScope={onRefreshScope} {...(online ? { onReplay: () => { void recording.retry(); } } : {})} />
      <Button type="submit" disabled={!online || frozen || !journal || (!result.sessionId && !result.customer)}>
        {t(locale, result.sessionId ? 'serviceSessions.correctAndAppend' : 'serviceSessions.save')}
      </Button>
    </form>
    {journal ? <SessionSavedResult result={result} journal={journal} onNewVisit={recording.replaceResult} /> : null}
  </FormProvider>;
}
