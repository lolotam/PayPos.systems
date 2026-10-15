'use client';
import { serviceSessionErrors, t, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import type { RecoveryConfirmOutcome, SessionRecordingResult } from '../model/session-recording-result';
import { SessionOwnRecordings } from './session-own-recordings';

const keys = { SAVING: 'serviceSessions.saving', COMPLETE: 'serviceSessions.saved', PARTIAL: 'serviceSessions.partial',
  ALL_REJECTED: 'serviceSessions.nothingSaved', UNRESOLVED: 'serviceSessions.unresolved', EXPIRED: 'serviceSessions.expired',
  SAVED_DISPLAY_FAILED: 'serviceSessions.savedDisplayFailed' } satisfies Partial<Record<SessionRecordingResult['feedback']['kind'], MessageKey>>;
export function SessionWriteFeedback({ result, onReplay, onRefreshScope, scope, timeZone, onConfirm }: {
  result: SessionRecordingResult; onReplay?: () => void; onRefreshScope?: () => void;
  scope?: SessionServiceScope; timeZone?: string; onConfirm?: (outcome: RecoveryConfirmOutcome) => void;
}) {
  const locale = useLocale(), feedback = result.feedback;
  const expiredAttempt = feedback.kind === 'EXPIRED' ? result.expiredAttempt : null;
  const authorityError = feedback.kind === 'ERROR' && feedback.refreshScope ? feedback.error : null, refreshed = useRef<unknown>(null);
  useEffect(() => {
    if (authorityError && onRefreshScope && refreshed.current !== authorityError) { refreshed.current = authorityError; onRefreshScope(); }
  }, [authorityError, onRefreshScope]);
  if (feedback.kind === 'IDLE') return null;
  const message = feedback.kind === 'ERROR' ? envelopeMessage(feedback.error, locale) : feedback.kind === 'NOT_PERSISTED'
    ? envelopeMessage(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED, locale) : t(locale, keys[feedback.kind]);
  const status = ['SAVING', 'COMPLETE', 'PARTIAL'].includes(feedback.kind);
  return <div className="grid gap-2 text-start">
    <p role={status ? 'status' : 'alert'}>{message}</p>
    {result.persistenceWarning && feedback.kind !== 'NOT_PERSISTED' ? <p role="alert">{envelopeMessage(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED, locale)}</p> : null}
    {feedback.kind === 'UNRESOLVED' && result.attempt && onReplay ? <Button type="button" variant="outline" onClick={onReplay}>{t(locale, 'serviceSessions.retryOriginal')}</Button> : null}
    {expiredAttempt && scope && timeZone && onConfirm ? <SessionOwnRecordings scope={scope} attempt={expiredAttempt} timeZone={timeZone} onConfirm={onConfirm} /> : null}
  </div>;
}
