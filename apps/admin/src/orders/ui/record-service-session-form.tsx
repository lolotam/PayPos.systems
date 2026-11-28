'use client';
import type { RecordingContext } from '@pospay/contracts';
import { normalizeToleratedVisitInstant } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm, useWatch, type UseFormReset, type UseFormReturn } from 'react-hook-form';
import { useRevokeOwnRecording } from '../api/use-own-recordings';
import type { SessionServiceScope } from '../api/use-session-services';
import type { ExpiredRecoveryProof, SessionAttemptJournal } from '../model/session-attempt-journal';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { sessionLocalTime } from '../model/session-local-time';
import { confirmExpiredRecording, leaveUnknownVisit, sessionLeaveFeedback, sessionResultFrozen, type RecoveryConfirmOutcome, type SessionFeedback, type SessionRecordingResult } from '../model/session-recording-result';
import { reportSessionSubmitError } from '../model/session-submit-error';
import type { SessionRecordingController } from '../model/use-session-recording';
import { useServerAnchoredValue } from '../model/use-server-anchored-now';
import { useLocale } from '@/shared/locale/locale-context';
import { changeSessionCustomer } from './record-service-session-customer';
import { RecordVisitColumns } from './record-visit-columns';
import { RecordVisitCustomerField } from './record-visit-customer-field';
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

// فشل مسح العلامة يرمي قبل الإلغاء، فالرسالة تظهر واللوحة تفضل لأن التخزين لسه شايل المحاولة.
export function bindExpiredConfirm(recording: SessionRecordingController, revoke: (proof: ExpiredRecoveryProof) => Promise<unknown>) {
  return (outcome: RecoveryConfirmOutcome) => {
    if (!recording.journal || recording.result.feedback.kind !== 'EXPIRED') return;
    try {
      recording.replaceResult(confirmExpiredRecording(recording.result, recording.journal, outcome, revoke));
    } catch (error) {
      if (sessionLeaveFeedback(error).kind !== 'NOT_PERSISTED') throw error;
      recording.replaceResult({ ...recording.result, persistenceWarning: 'NOT_PERSISTED' });
    }
  };
}

// النتيجة المحفوظة بتختفي لما session تكون null، فالزر هنا هو طريق الخروج الوحيد من زيارة وقتها مش معروف.
function leaveUnknownTimeVisit(
  result: SessionRecordingResult,
  journal: Pick<SessionAttemptJournal, 'leaveVisit'> | null,
  replace: (next: SessionRecordingResult) => void,
  report: (feedback: SessionFeedback) => void,
  hideCustomer: boolean,
) {
  if (!journal) return;
  try {
    const next = leaveUnknownVisit(result, journal);
    // رفض ملف الزبونة يمنع ترجيع بياناتها عند بدء زيارة جديدة بعد الخروج من وقت غير معروف (#1187).
    replace(hideCustomer ? { ...next, customer: null, customerId: null } : next);
  } catch (error) {
    report(sessionLeaveFeedback(error));
  }
}

function useCustomerDenial({
  scope,
  result,
  recording,
  form,
  lastKnownCustomerId,
}: {
  scope: SessionServiceScope;
  result: SessionRecordingResult;
  recording: SessionRecordingController;
  form: UseFormReturn<SessionDraftForm>;
  lastKnownCustomerId: { current: string | null };
}) {
  // رفض ملف الزبونة يرتبط بالنطاق والزبونة مش بـ sessionId، عشان يفضل محجوب عبر إكمال الحفظ الأول وتحولات الزيارة (#1187).
  const customerKey = result.customerId === null ? null : JSON.stringify([scope.companyId, scope.userId, scope.businessId, scope.branchId, result.customerId]);
  const [deniedCustomerKey, setDeniedCustomerKey] = useState<string | null>(null);
  const hideCustomer = customerKey !== null && deniedCustomerKey === customerKey;
  if (deniedCustomerKey !== null && !hideCustomer) setDeniedCustomerKey(null);
  const lines = useWatch({ control: form.control, name: 'lines' });
  const hiddenPackageDraft = hideCustomer && (lines?.some((line) => line.from_package) ?? false);
  // لو الحفظ الأول اتجمد وقت رفض الملف وبعدين فشل وبقى قابل للتعديل، نسقّط الاختيار المؤقت فورًا عشان ما يتبعتش تاني (#1188).
  const clearDeniedTransient = hideCustomer && !sessionResultFrozen(result) && result.sessionId === null && result.customerId !== null;
  useEffect(() => {
    if (clearDeniedTransient) changeSessionCustomer(null, result, recording, form, lastKnownCustomerId);
  }, [clearDeniedTransient, result, recording, form, lastKnownCustomerId]);
  return {
    hideCustomer,
    hiddenPackageDraft,
    denyCustomer: () => { if (customerKey !== null) setDeniedCustomerKey(customerKey); },
  };
}

function resolvePackageVisitAt(draftedAt: string, serverNowIso: string): string | undefined {
  const draftedDate = new Date(draftedAt);
  const serverNowDate = new Date(serverNowIso);
  if (!Number.isFinite(draftedDate.getTime()) || !Number.isFinite(serverNowDate.getTime())) {
    return undefined;
  }
  return normalizeToleratedVisitInstant(draftedDate, serverNowDate).toISOString();
}

function usePackageVisitWindow(
  context: RecordingContext,
  form: UseFormReturn<SessionDraftForm>,
  savedAt: string | undefined,
) {
  const draftedAt = useWatch({ control: form.control, name: 'occurred_at' });
  const occurredAt = savedAt ?? draftedAt;
  const packageTimezone = context.branch_timezone ?? context.business_timezone;
  const impliedDate = useServerAnchoredValue(context.generated_at, (instant) =>
    sessionLocalTime(instant, packageTimezone).slice(0, 10),
  );
  const draftedPackageAt = useServerAnchoredValue(
    context.generated_at,
    (instant) =>
      savedAt === undefined && draftedAt ? resolvePackageVisitAt(draftedAt, instant) : undefined,
    `${savedAt ?? ''}|${draftedAt ?? ''}`,
  );
  const packageOccurredAt = savedAt ?? draftedPackageAt;
  const visitDate = packageOccurredAt
    ? sessionLocalTime(packageOccurredAt, packageTimezone).slice(0, 10)
    : impliedDate;
  return { occurredAt, packageOccurredAt, visitDate };
}

export function RecordServiceSessionForm({ scope, context, online, recording, onRefreshScope, top }: {
  scope: SessionServiceScope; context: RecordingContext; online: boolean; recording: SessionRecordingController;
  onRefreshScope: () => void; top?: ReactNode;
}) {
  const locale = useLocale();
  const revoke = useRevokeOwnRecording();
  const { result, journal } = recording;
  const lastKnownCustomerId = useRef<string | null>(result.customerId);
  useEffect(() => {
    if (result.customerId !== null) lastKnownCustomerId.current = result.customerId;
  }, [result.customerId]);
  const frozen = sessionResultFrozen(result);
  // أول حفظ بيثبّت رأس الزيارة (الزبونة والوقت والعضوية)؛ سطور التصحيح بس اللي تفضل مفتوحة.
  const locked = frozen || result.sessionId !== null;
  // زيارة PARTIAL مسترجعة بعد reload مش شايلة العضوية؛ القائمة تفضل مفتوحة لحد ما العضوية تتعرف، وإلا التصحيح يترفض
  // بـ SESSION_RECORDER_MEMBERSHIP_REQUIRED لمسجّلة عندها أكتر من عضوية.
  const membershipFixed = result.sessionId !== null && result.drafts.recorder_membership_id != null;
  const timeUnknown = result.visitTimeUnknown;
  const savedAt = result.session?.occurred_at;
  const [seed] = useState(() => shownVisitTime(result.drafts, savedAt));
  const [leaveFailure, setLeaveFailure] = useState<{ source: SessionRecordingResult; feedback: SessionFeedback } | null>(null);
  // العداد هنا عشان فك المحرر ما يفكّش القفل والـ PATCH لسه ما خلصش. النهاية بتيجي من finally حتى بعد الفك.
  const [editsInFlight, setEditsInFlight] = useState(0);
  const editBusy = editsInFlight > 0;
  const beginLineEdit = () => { setEditsInFlight((count) => count + 1); };
  const endLineEdit = () => { setEditsInFlight((count) => count - 1); };
  const form = useForm<SessionDraftForm>({ defaultValues: seed });
  const { hideCustomer, hiddenPackageDraft, denyCustomer } = useCustomerDenial({ scope, result, recording, form, lastKnownCustomerId });
  const { occurredAt, packageOccurredAt, visitDate } = usePackageVisitWindow(context, form, savedAt);
  useDraftReset(form.reset, result.drafts, savedAt);
  const rootError = form.formState.errors.root?.message;
  const unknownLeave = leaveFailure?.source === result ? leaveFailure.feedback : null;
  return <RecordVisitColumns form={form} top={top} main={(onLimitChange) => <>
    <form className="grid gap-4 text-start" noValidate onSubmit={form.handleSubmit(async (drafts) => {
      if (editBusy || hiddenPackageDraft || (hideCustomer && drafts.lines.some((line) => line.from_package)) || (!result.sessionId && (!result.customer || hideCustomer))) return;
      try { await recording.submit(drafts); } catch (error) { reportSessionSubmitError(form.setError, error, locale); }
    })}>
      <RecordVisitCustomerField scope={scope} result={result} recording={recording} form={form}
        lastKnownCustomerId={lastKnownCustomerId} online={online} locked={locked} hideCustomer={hideCustomer}
        onAccessDenied={() => { denyCustomer(); onRefreshScope(); }} />
      {timeUnknown ? <div className="grid gap-2">
        <p role="alert">{t(locale, 'serviceSessions.unknownVisitTime')}</p>
        <Button type="button" variant="outline" disabled={!journal || editBusy} onClick={() => { if (editBusy) return; leaveUnknownTimeVisit(result, journal, recording.replaceResult, (feedback) => setLeaveFailure({ source: result, feedback }), hideCustomer); }}>{t(locale, hideCustomer ? 'serviceSessions.newVisit' : 'serviceSessions.newVisitSameCustomer')}</Button>
        {unknownLeave ? <SessionWriteFeedback result={{ ...result, feedback: unknownLeave, attempt: null }} /> : null}
      </div> : <SessionTimeField context={context} disabled={locked} />}
      <SessionRecordingHeader scope={scope} disabled={!online || frozen} readOnly={membershipFixed} onLimitChange={onLimitChange} />
      <SessionDraftLines scope={scope} customerId={hideCustomer ? null : result.customerId} {...(occurredAt !== undefined ? { occurredAt } : {})}
        {...(packageOccurredAt !== undefined ? { packageOccurredAt } : {})} visitDate={visitDate} disabled={!online || frozen || timeUnknown} />
      <SessionRejectedLines result={result} onEdit={focusDraftPrice} scope={scope} online={online} />
      {rootError ? <p role="alert">{rootError}</p> : null}
      <SessionWriteFeedback result={result} onRefreshScope={onRefreshScope} {...(online && !editBusy ? { onReplay: () => { void recording.retry(); } } : {})}
        {...(journal && result.expiredAttempt && !editBusy ? { scope, timeZone: context.business_timezone, onConfirm: bindExpiredConfirm(recording, (proof) => revoke.mutateAsync(proof)) } : {})} />
      <Button type="submit" disabled={!online || frozen || timeUnknown || editBusy || !journal || hiddenPackageDraft || (!result.sessionId && (!result.customer || hideCustomer))} onClick={(event) => { if (editBusy) event.preventDefault(); }}>
        {t(locale, result.sessionId ? 'serviceSessions.correctAndAppend' : 'serviceSessions.save')}
      </Button>
    </form>
    {journal ? <SessionSavedResult result={result} journal={journal} onNewVisit={recording.replaceResult} hideCustomer={hideCustomer} scope={scope} online={online} editBusy={editBusy} onRequestStart={beginLineEdit} onRequestEnd={endLineEdit} /> : null}
  </>} />;
}
