'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import type { SessionServiceScope } from '../api/use-session-services';
import { useRecordingContext } from '../api/use-recording-context';
import { sessionResultFrozen } from '../model/session-recording-result';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { useSessionRecording } from '../model/use-session-recording';
import { RecordServiceSessionForm } from '../ui/record-service-session-form';
import { SessionWriteFeedback } from '../ui/session-write-feedback';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

function isForbidden(error: unknown) {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 403;
}

export function RecordServiceSessionPage({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  const connectivity = useBrowserConnectivity();
  const online = connectivity === true;
  useSessionQueryLifecycle(scope, connectivity);
  const recording = useSessionRecording(scope);
  const context = useRecordingContext(scope, null, online && !sessionResultFrozen(recording.result));
  const forbidden = isForbidden(context.error);
  // 403 بيقفل الشاشة لأن إعادة المحاولة هترجع نفس الرفض. إعادة قراءة السياق قراءة جديدة: بتتقفل أوفلاين، وبتظهر بعد فشل القراءة أو والمحاولة متجمدة من غير بيانات ومن غير طلب شغال.
  const editor = context.data && !forbidden ? context.data : null;
  const contextRetry = online && !editor && !forbidden
    && (context.isError || (sessionResultFrozen(recording.result) && !context.isFetching));
  return <section className="grid gap-4 text-start">
    <PageHeader title={t(locale, 'serviceSessions.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    {context.error ? <p role="alert">{envelopeMessage(context.error, locale)}</p> : null}
    {contextRetry ? <Button type="button" variant="outline" onClick={() => { void context.refetch(); }}>{t(locale, 'serviceSessions.retryContext')}</Button> : null}
    {editor ? <RecordServiceSessionForm scope={scope} context={editor} online={online} recording={recording}
      onRefreshScope={() => { void context.refetch(); }} /> : null}
    {editor || forbidden ? null : <SessionWriteFeedback result={recording.result} {...(online ? { onReplay: () => { void recording.retry(); } } : {})} />}
  </section>;
}
