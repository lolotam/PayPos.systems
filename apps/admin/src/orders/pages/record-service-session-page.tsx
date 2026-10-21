'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import type { SessionServiceScope } from '../api/use-session-services';
import { useRecordingContext } from '../api/use-recording-context';
import { useRevokeOwnRecording } from '../api/use-own-recordings';
import { sessionResultFrozen } from '../model/session-recording-result';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { useRecordPermission } from '../model/use-record-permission';
import { useSessionRecording } from '../model/use-session-recording';
import { bindExpiredConfirm, RecordServiceSessionForm } from '../ui/record-service-session-form';
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
  const revoke = useRevokeOwnRecording();
  const reading = online && !sessionResultFrozen(recording.result);
  const context = useRecordingContext(scope, null, reading);
  const permission = useRecordPermission(scope, reading);
  const forbidden = isForbidden(context.error) || permission.refused;
  const refusal = context.error ?? permission.refusal;
  // 403 بيقفل الشاشة لأن إعادة المحاولة هترجع نفس الرفض. إعادة قراءة السياق قراءة جديدة: بتتقفل أوفلاين، وبتظهر بعد فشل القراءة أو والمحاولة متجمدة من غير بيانات ومن غير طلب شغال.
  const editor = context.data && !forbidden && !permission.waiting ? context.data : null;
  const contextRetry = online && !editor && !forbidden
    && (context.isError || (sessionResultFrozen(recording.result) && !context.isFetching));
  const expiredConfirm = recording.journal && recording.result.expiredAttempt
    ? bindExpiredConfirm(recording, (proof) => revoke.mutateAsync(proof)) : null;
  return <section className="grid gap-4 text-start">
    <PageHeader title={t(locale, 'serviceSessions.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    {refusal ? <p role="alert">{envelopeMessage(refusal, locale)}</p> : null}
    {permission.failed && !refusal ? <p role="alert">{envelopeMessage(permission.failed, locale)} <Button type="button" variant="outline"
      disabled={!online} onClick={permission.retry}>{t(locale, 'serviceSessions.retryServices')}</Button></p> : null}
    {contextRetry ? <Button type="button" variant="outline" onClick={() => { void context.refetch(); }}>{t(locale, 'serviceSessions.retryContext')}</Button> : null}
    {editor ? <RecordServiceSessionForm scope={scope} context={editor} online={online} recording={recording}
      onRefreshScope={() => { void context.refetch(); }} /> : null}
    {editor || (forbidden && !expiredConfirm) ? null : <SessionWriteFeedback result={recording.result}
      {...(online ? { onReplay: () => { void recording.retry(); } } : {})}
      {...(expiredConfirm ? { scope, onConfirm: expiredConfirm } : {})} />}
  </section>;
}
