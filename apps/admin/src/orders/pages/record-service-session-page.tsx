'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useEffect, useState } from 'react';
import type { SessionServiceScope } from '../api/use-session-services';
import { useRecordingContext } from '../api/use-recording-context';
import { sessionResultFrozen } from '../model/session-recording-result';
import { useSessionRecording } from '../model/use-session-recording';
import { RecordServiceSessionForm } from '../ui/record-service-session-form';
import { SessionWriteFeedback } from '../ui/session-write-feedback';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

function useBrowserOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

function isForbidden(error: unknown) {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 403;
}

export function RecordServiceSessionPage({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  const online = useBrowserOnline();
  const recording = useSessionRecording(scope);
  const context = useRecordingContext(scope, null, online && !sessionResultFrozen(recording.result));
  const forbidden = isForbidden(context.error);
  // سياق التسجيل ممكن يفشل أو يتقفل والمحاولة لسه غير محسومة؛ الاسترجاع وإعادة القراءة مش مربوطين بنجاح السياق.
  const editor = context.data && !forbidden ? context.data : null;
  const contextWaiting = !editor && !forbidden && (context.isError || sessionResultFrozen(recording.result));
  return <section className="grid gap-4 text-start">
    <PageHeader title={t(locale, 'serviceSessions.title')} />
    {online ? null : <p role="status">{t(locale, 'serviceSessions.offline')}</p>}
    {context.error ? <p role="alert">{envelopeMessage(context.error, locale)}</p> : null}
    {contextWaiting ? <Button type="button" variant="outline" onClick={() => { void context.refetch(); }}>{t(locale, 'serviceSessions.retryContext')}</Button> : null}
    {editor ? <RecordServiceSessionForm scope={scope} context={editor} online={online} recording={recording}
      onRefreshScope={() => { void context.refetch(); }} /> : <SessionWriteFeedback result={recording.result} {...(online ? { onReplay: () => { void recording.retry(); } } : {})} />}
  </section>;
}
