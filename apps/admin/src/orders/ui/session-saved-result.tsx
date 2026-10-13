'use client';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { Badge, Button, Card } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { newSessionVisit, sessionBpsText, sessionResultFrozen, sessionResultLate, type SessionRecordingResult } from '../model/session-recording-result';
import type { SessionAttemptJournal } from '../model/session-attempt-journal';

export function SessionSavedResult({ result, journal, onNewVisit }: {
  result: SessionRecordingResult; journal: Pick<SessionAttemptJournal, 'leaveVisit'>; onNewVisit: (result: SessionRecordingResult) => void;
}) {
  const locale = useLocale(), session = result.session;
  if (!session) return null;
  const name = (item: { name_ar: string | null; name_en: string }) => locale === 'ar' ? item.name_ar ?? item.name_en : item.name_en;
  const when = formatInstant(new Date(session.occurred_at), locale, session.business_timezone);
  const complete = result.feedback.kind === 'COMPLETE' && !result.drafts.lines.length && !sessionResultFrozen(result);
  return <Card className="grid gap-3 p-3 text-start">
    <p role="status">{t(locale, 'serviceSessions.saved')}</p>
    <p>{session.customer.name} <bdi>{session.customer.phone_masked}</bdi></p>
    <p>{t(locale, 'serviceSessions.occurredAt')} <bdi>{when}</bdi></p>
    <p>{t(locale, 'serviceSessions.timezone')} <bdi>{session.business_timezone}</bdi></p>
    {sessionResultLate(session) ? <Badge variant="warning">{t(locale, 'serviceSessions.late')}</Badge> : null}
    <p>{t(locale, 'serviceSessions.savedTotal')} <bdi>{formatKwd(parseMoney(session.total_net))}</bdi></p>
    <ul className="grid gap-3">{session.lines.map((line) => <li key={line.id} className="grid gap-2">
      <p>{name(line)} <Badge variant="secondary">{t(locale, 'serviceSessions.readOnly')}</Badge>
        {result.addedLineIds.includes(line.id) ? <Badge variant="success">{t(locale, 'serviceSessions.newlySaved')}</Badge> : null}</p>
      <dl><dt>{t(locale, 'serviceSessions.price')}</dt><dd><bdi>{formatKwd(parseMoney(line.price))}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.discountAmount')}</dt><dd><bdi>{formatKwd(parseMoney(line.discount))}</bdi></dd>
        <dt>{t(locale, 'serviceSessions.savedNet')}</dt><dd><bdi>{formatKwd(parseMoney(line.net))}</bdi></dd></dl>
      {line.performers.map((performer) => <div key={performer.id}>
        <p>{name(performer)} <bdi>{t(locale, 'serviceSessions.percentValue').replace('{value}', sessionBpsText(performer.share_bps))}</bdi></p>
        {performer.not_clocked_in_warning || performer.approved_leave_warning ? <div role="status">
          {([['not_clocked_in_warning', 'notClockedIn'], ['approved_leave_warning', 'approvedLeave']] as const).map(([flag, key]) => performer[flag] ?
            <p key={flag}>{name(performer)} — {when}: {t(locale, `serviceSessions.${key}`)}</p> : null)}
        </div> : null}
      </div>)}
    </li>)}</ul>
    {complete ? <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => onNewVisit(newSessionVisit(result, journal, false))}>{t(locale, 'serviceSessions.newVisit')}</Button>
      <Button type="button" variant="outline" onClick={() => onNewVisit(newSessionVisit(result, journal, true))}>{t(locale, 'serviceSessions.newVisitSameCustomer')}</Button>
    </div> : null}
  </Card>;
}
