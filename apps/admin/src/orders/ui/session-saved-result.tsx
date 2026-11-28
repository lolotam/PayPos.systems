'use client';
import { formatInstant, t } from '@pospay/i18n';
import { Badge, Button, Card } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import type { SessionAttemptJournal } from '../model/session-attempt-journal';
import { newSessionVisit, sessionLeaveFeedback, sessionResultFrozen, sessionResultLate, type SessionFeedback, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionSavedVisit } from './session-saved-visit';
import { SessionWriteFeedback } from './session-write-feedback';
import { useTipAttemptMemory } from './use-tip-attempt-memory';

export function SessionSavedResult({ result, journal, onNewVisit, scope, online = true, editBusy = false, hideCustomer = false, onRequestStart, onRequestEnd }: {
  result: SessionRecordingResult; journal: Pick<SessionAttemptJournal, 'leaveVisit'>; onNewVisit: (result: SessionRecordingResult) => void;
  scope?: SessionServiceScope; online?: boolean; editBusy?: boolean; hideCustomer?: boolean; onRequestStart?: () => void; onRequestEnd?: () => void;
}) {
  const locale = useLocale(), session = result.session;
  const [failure, setFailure] = useState<{ source: SessionRecordingResult; feedback: SessionFeedback } | null>(null);
  const tipMemory = useTipAttemptMemory(scope?.companyId ?? '', scope?.businessId ?? '', scope?.branchId ?? '', scope?.userId ?? '');
  if (!session) return null;
  const leaveFeedback = failure?.source === result ? failure.feedback : null;
  const leave = (sameCustomer: boolean) => {
    if (editBusy) return;
    // رفض ملف الزبونة يمنع ترجيع ملخصها في الزيارة التالية حتى لو المستخدم اختار نفس الزبونة (#1187).
    try { onNewVisit(newSessionVisit(result, journal, sameCustomer && !hideCustomer)); }
    catch (error) { setFailure({ source: result, feedback: sessionLeaveFeedback(error) }); }
  };
  const when = formatInstant(new Date(session.occurred_at), locale, session.business_timezone);
  const complete = !leaveFeedback && result.feedback.kind === 'COMPLETE' && !result.drafts.lines.length && !sessionResultFrozen(result);
  return <Card className="grid gap-3 p-3 text-start">
    <p role="status">{t(locale, 'serviceSessions.saved')}</p>
    {hideCustomer ? null : <p>{session.customer.name} <bdi>{session.customer.phone_masked}</bdi></p>}
    <p>{t(locale, 'serviceSessions.occurredAt')} <bdi>{when}</bdi></p>
    <p>{t(locale, 'serviceSessions.timezone')} <bdi>{session.business_timezone}</bdi></p>
    {sessionResultLate(session) ? <Badge variant="warning">{t(locale, 'serviceSessions.late')}</Badge> : null}
    <SessionSavedVisit result={result} online={online} editBusy={editBusy} tipMemory={tipMemory} {...(scope ? { scope } : {})}
      {...(onRequestStart ? { onRequestStart } : {})} {...(onRequestEnd ? { onRequestEnd } : {})} />
    {leaveFeedback ? <SessionWriteFeedback result={{ ...result, feedback: leaveFeedback, attempt: null }} /> : null}
    {complete ? <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={editBusy} onClick={() => leave(false)}>{t(locale, 'serviceSessions.newVisit')}</Button>
      {hideCustomer ? null : <Button type="button" variant="outline" disabled={editBusy} onClick={() => leave(true)}>{t(locale, 'serviceSessions.newVisitSameCustomer')}</Button>}
    </div> : null}
  </Card>;
}
