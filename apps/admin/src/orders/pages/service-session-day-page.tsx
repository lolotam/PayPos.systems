'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { SessionServiceScope } from '../api/use-session-services';
import { sessionLocalTime } from '../model/session-local-time';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { EditServiceLineForm } from '../ui/edit-service-line-form';
import { ServiceLineEditHistory } from '../ui/service-line-edit-history';
import { ServiceSessionDayFilters } from '../ui/service-session-day-filters';
import { ServiceSessionDayVisit } from '../ui/service-session-day-visit';

type Visit = DayPage['items'][number];

function findLine(visits: Visit[], key: string | null) {
  if (!key) return null;
  for (const visit of visits) {
    const line = visit.lines.find((item) => `${visit.id}:${item.id}` === key);
    if (line) return { visit, line };
  }
  return null;
}

export function ServiceSessionDayPage({ scope, timezone }: { scope: SessionServiceScope; timezone: string }) {
  const locale = useLocale();
  const connectivity = useBrowserConnectivity();
  const online = connectivity === true;
  useSessionQueryLifecycle(scope, connectivity);
  const [date, setDate] = useState(() => sessionLocalTime(new Date().toISOString(), timezone).slice(0, 10));
  const [lateOnly, setLateOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useBranchDaySessions(scope, date, lateOnly, online);
  const visits = query.data?.pages.flatMap((page) => page.items) ?? [];
  const target = findLine(visits, editing);
  return <section className="grid gap-4 text-start" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageHeader title={t(locale, 'serviceLineEdit.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <ServiceSessionDayFilters date={date} lateOnly={lateOnly} onDate={setDate} onLate={setLateOnly} />
    {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)} <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p> : null}
    {query.isSuccess && visits.length === 0 ? <p>{t(locale, 'serviceLineEdit.empty')}</p> : null}
    {visits.map((visit) => {
      const historyLineId = history?.startsWith(`${visit.id}:`) ? history.slice(visit.id.length + 1) : null;
      return <ServiceSessionDayVisit key={visit.id} visit={visit} locale={locale} activeLineId={target?.visit.id === visit.id ? target.line.id : null} historyLineId={historyLineId}
        onEdit={(lineId) => { setNotice(null); setEditing(`${visit.id}:${lineId}`); }}
        onToggleHistory={(lineId) => setHistory((current) => current === `${visit.id}:${lineId}` ? null : `${visit.id}:${lineId}`)}
        editor={target?.visit.id === visit.id ? <EditServiceLineForm key={target.line.id} scope={scope} sessionId={visit.id} line={target.line} online={online}
          onSaved={() => { setEditing(null); setNotice(t(locale, 'serviceLineEdit.saved')); }}
          onStale={() => { void query.refetch(); }}
          onForbidden={(message) => { setEditing(null); setNotice(message); }}
          onClose={() => setEditing(null)} /> : null}
        historyPanel={historyLineId ? <ServiceLineEditHistory scope={scope} sessionId={visit.id} lineId={historyLineId} timezone={visit.business_timezone} /> : null} />;
    })}
    {query.hasNextPage ? <Button type="button" variant="outline" onClick={() => { void query.fetchNextPage(); }}>{t(locale, 'serviceLineEdit.loadMore')}</Button> : null}
  </section>;
}
