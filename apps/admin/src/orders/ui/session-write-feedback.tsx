'use client';
import { serviceSessionErrors, t, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionRecordingResult } from '../model/session-recording-result';

const keys = { SAVING: 'serviceSessions.saving', COMPLETE: 'serviceSessions.saved', PARTIAL: 'serviceSessions.partial',
  ALL_REJECTED: 'serviceSessions.nothingSaved', UNRESOLVED: 'serviceSessions.unresolved', EXPIRED: 'serviceSessions.expired',
  SAVED_DISPLAY_FAILED: 'serviceSessions.savedDisplayFailed' } satisfies Partial<Record<SessionRecordingResult['feedback']['kind'], MessageKey>>;
export function SessionWriteFeedback({ result, onReplay }: { result: SessionRecordingResult; onReplay: () => void }) {
  const locale = useLocale(), feedback = result.feedback;
  if (feedback.kind === 'IDLE') return null;
  const message = feedback.kind === 'ERROR' ? envelopeMessage(feedback.error, locale) : feedback.kind === 'NOT_PERSISTED'
    ? envelopeMessage(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED, locale) : t(locale, keys[feedback.kind]);
  const status = ['SAVING', 'COMPLETE', 'PARTIAL'].includes(feedback.kind);
  return <div className="grid gap-2 text-start">
    <p role={status ? 'status' : 'alert'}>{message}</p>
    {result.persistenceWarning && feedback.kind !== 'NOT_PERSISTED' ? <p role="alert">{envelopeMessage(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED, locale)}</p> : null}
    {feedback.kind === 'UNRESOLVED' && result.attempt ? <Button type="button" variant="outline" onClick={onReplay}>{t(locale, 'serviceSessions.retryOriginal')}</Button> : null}
  </div>;
}
