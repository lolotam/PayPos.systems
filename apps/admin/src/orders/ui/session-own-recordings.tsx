'use client';
import type { ServiceSessionRecoveryVisit } from '@pospay/contracts';
import { formatInstant, t, type Locale, type MessageKey } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useOwnRecordings } from '../api/use-own-recordings';
import type { SessionServiceScope } from '../api/use-session-services';
import type { ExpiredAttemptView, RecoveryConfirmOutcome } from '../model/session-recording-result';
import { suggestedRecoveryConfirmation, type RecoveryPanel } from '../model/session-recovery-state';

type ServiceSessionRecoveryLine = ServiceSessionRecoveryVisit['lines'][number];

function fill(locale: Locale, key: MessageKey, when: string) {
  return t(locale, key).replace('{when}', when);
}
function shownInstant(value: string, locale: Locale, timeZone: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatInstant(date, locale, timeZone);
}
function leadKey(panel: RecoveryPanel): MessageKey {
  if (panel.kind === 'NEVER_REACHED') return 'serviceSessions.recoveryNeverReached';
  if (panel.kind === 'CANNOT_VERIFY') return 'serviceSessions.recoveryCannotVerify';
  if (panel.kind === 'WINDOW_ENDED') return 'serviceSessions.recoveryWindowEnded';
  if (panel.kind === 'NOT_YET') return panel.opensAt ? 'serviceSessions.recoveryNotYet' : 'serviceSessions.recoveryNotYetUntimed';
  if (panel.outcome === 'COMMITTED') return 'serviceSessions.recoveryCommitted';
  if (panel.outcome === 'NOT_COMMITTED') return 'serviceSessions.recoveryNotCommitted';
  return panel.visits.length === 0 ? 'serviceSessions.recoveryEmpty' : 'serviceSessions.recoveryCheckFirst';
}
function leadText(panel: RecoveryPanel, locale: Locale, timeZone: string) {
  const when = panel.kind === 'NOT_YET' && panel.opensAt ? shownInstant(panel.opensAt, locale, timeZone) : '';
  return fill(locale, leadKey(panel), when);
}
function noticeText(panel: Extract<RecoveryPanel, { kind: 'LIST' }>, locale: Locale, timeZone: string) {
  if (panel.notice === 'WINDOW_ENDED') return t(locale, 'serviceSessions.recoveryWindowEnded');
  if (panel.notice !== 'NOT_YET') return null;
  return panel.opensAt ? fill(locale, 'serviceSessions.recoveryNotYet', shownInstant(panel.opensAt, locale, timeZone)) : t(locale, 'serviceSessions.recoveryNotYetUntimed');
}
function lineName(line: ServiceSessionRecoveryLine, locale: Locale) {
  return locale === 'ar' ? line.name_ar ?? line.name_en : line.name_en;
}
function visitBlock(visit: ServiceSessionRecoveryVisit, locale: Locale, timeZone: string) {
  return { name: visit.customer_name, phone: visit.customer_phone_masked, when: shownInstant(visit.occurred_at, locale, timeZone), lines: visit.lines.map((line) => ({ id: line.id, name: lineName(line, locale) })) };
}

export function SessionOwnRecordings({ scope, attempt, timeZone, onConfirm }: {
  scope: SessionServiceScope; attempt: ExpiredAttemptView; timeZone: string; onConfirm: (outcome: RecoveryConfirmOutcome) => void;
}) {
  const locale = useLocale();
  const recordings = useOwnRecordings(scope, attempt);
  const panel = recordings.panel;
  const suggested = suggestedRecoveryConfirmation(panel);
  const zone = panel?.kind === 'LIST' ? panel.businessTimezone : timeZone;
  const list = panel?.kind === 'LIST' ? panel : null;
  const notice = list ? noticeText(list, locale, zone) : null;
  const recorded = suggested === 'RECORDED_ELSEWHERE';
  const missed = suggested === 'NOT_RECORDED';
  return <div className="grid gap-2 text-start">
    <p><bdi>{fill(locale, 'serviceSessions.recoveryAttemptAt', shownInstant(new Date(attempt.createdAt).toISOString(), locale, timeZone))}</bdi></p>
    <p role="status">{panel ? leadText(panel, locale, zone) : t(locale, 'serviceSessions.recoveryCheckFirst')}</p>
    {list?.outcome ? <p>{t(locale, 'serviceSessions.recoveryCheckFirst')}</p> : null}
    {list && list.visits.length === 0 && list.outcome ? <p>{t(locale, 'serviceSessions.recoveryEmpty')}</p> : null}
    {list?.visits.map((visit) => {
      const row = visitBlock(visit, locale, zone);
      return <div key={visit.id} className="grid gap-1">
        <p>{row.name}</p>
        <p><bdi>{row.phone}</bdi></p>
        <p><bdi>{row.when}</bdi></p>
        {row.lines.map((line) => <p key={line.id}>{line.name}</p>)}
      </div>;
    })}
    {notice ? <p role="status">{notice}</p> : null}
    {list?.nextCursor ? <Button type="button" variant="outline" disabled={recordings.isFetchingNextPage} onClick={() => { void recordings.fetchNextPage(); }}>{t(locale, 'serviceSessions.recoveryMore')}</Button> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant={recorded ? 'default' : 'outline'} aria-pressed={recorded} onClick={() => onConfirm('RECORDED_ELSEWHERE')}>{t(locale, 'serviceSessions.recoveryRecorded')}</Button>
      <Button type="button" variant={missed ? 'default' : 'outline'} aria-pressed={missed} onClick={() => onConfirm('NOT_RECORDED')}>{t(locale, 'serviceSessions.recoveryNotRecorded')}</Button>
    </div>
  </div>;
}
