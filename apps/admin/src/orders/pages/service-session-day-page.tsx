'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useRef, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked, serviceSessionDenial } from '../model/service-session-access';
import { sessionLocalTime } from '../model/session-local-time';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { EditServiceLineForm } from '../ui/edit-service-line-form';
import { ServiceLineEditHistory } from '../ui/service-line-edit-history';
import { ServiceSessionDayFilters } from '../ui/service-session-day-filters';
import { ServiceSessionDayVisit } from '../ui/service-session-day-visit';

type Visit = DayPage['items'][number];
type OpenEditor = { key: string; token: number };

// توكن جديد لكل فتحة؛ ضغطة تعديل على السطر المفتوح ما بتجدّدش التوكن عشان الحفظ الجاري يقفل نفس الفتحة.
function releaseEditor(key: string, token: number) {
  return (current: OpenEditor | null) => (current?.key === key && current.token === token ? null : current);
}

// مراجعة السطر بتتاخد من صفحات الجلب اللي طلبه الـ 409؛ لو الجلب فشل أو السطر مش موجود مفيش رقم يتبعت.
function lineRevision(pages: readonly DayPage[], sessionId: string, lineId: string): number | null {
  for (const page of pages) {
    const match = page.items.find((item) => item.id === sessionId)?.lines.find((item) => item.id === lineId);
    if (match) return match.revision;
  }
  return null;
}

function dayAccessKey(scope: SessionServiceScope, date: string, lateOnly: boolean) {
  return [scope.companyId, scope.businessId, scope.branchId, scope.userId, date, lateOnly].join(':');
}

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
  const editorToken = useRef(0);
  const [editing, setEditing] = useState<OpenEditor | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deniedFor, setDeniedFor] = useState<string | null>(null);
  const [patchDenial, setPatchDenial] = useState<{ key: string; at: number; message: string } | null>(null);
  const query = useBranchDaySessions(scope, date, lateOnly, online);
  const viewKey = dayAccessKey(scope, date, lateOnly);
  // نجاح الكاش الحالي أقدم من الـ 401؛ القفل يفضل لحد ما جلب لاحق يغيّر dataUpdatedAt.
  const patchHold = patchDenial?.key === viewKey && patchDenial.at === query.dataUpdatedAt;
  const access = serviceSessionDenial(deniedFor, viewKey, serviceSessionAccessRevoked(query.error), query.isSuccess && !query.isError && !patchHold);
  if (access.nextKey !== deniedFor) setDeniedFor(access.nextKey);
  if (access.denied && editing) setEditing(null);
  if (access.denied && history) setHistory(null);
  const visits = access.denied ? [] : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const target = findLine(visits, editing?.key ?? null);
  const alertText = query.isError ? envelopeMessage(query.error, locale) : patchDenial?.message;
  return <section className="grid gap-4 text-start" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageHeader title={t(locale, 'serviceLineEdit.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <ServiceSessionDayFilters date={date} lateOnly={lateOnly} onDate={setDate} onLate={setLateOnly} />
    {access.denied || query.isError ? <p role="alert">{alertText} <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p> : null}
    {!access.denied && query.isSuccess && visits.length === 0 ? <p>{t(locale, 'serviceLineEdit.empty')}</p> : null}
    {visits.map((visit) => {
      const historyLineId = history?.startsWith(`${visit.id}:`) ? history.slice(visit.id.length + 1) : null;
      const lineKey = target?.visit.id === visit.id ? `${visit.id}:${target.line.id}` : null;
      const openToken = editing?.token;
      return <ServiceSessionDayVisit key={visit.id} visit={visit} locale={locale} activeLineId={target?.visit.id === visit.id ? target.line.id : null} historyLineId={historyLineId}
        onEdit={(lineId) => { const key = `${visit.id}:${lineId}`; setNotice(null); if (editing?.key === key) return; editorToken.current += 1; setEditing({ key, token: editorToken.current }); }}
        onToggleHistory={(lineId) => setHistory((current) => current === `${visit.id}:${lineId}` ? null : `${visit.id}:${lineId}`)}
        editor={lineKey && target && openToken !== undefined ? <EditServiceLineForm key={target.line.id} scope={scope} sessionId={visit.id} line={target.line} online={online}
          onSaved={() => { setEditing(releaseEditor(lineKey, openToken)); setNotice(t(locale, 'serviceLineEdit.saved')); }}
          onStale={async () => { const fresh = await query.refetch(); return fresh.isSuccess ? lineRevision(fresh.data.pages, visit.id, target.line.id) : null; }}
          onForbidden={(message) => { setEditing(releaseEditor(lineKey, openToken)); setNotice(message); }}
          onUnauthenticated={(message) => { setPatchDenial({ key: viewKey, at: query.dataUpdatedAt, message }); setDeniedFor(viewKey); }}
          onClose={() => { setEditing(releaseEditor(lineKey, openToken)); }} /> : null}
        historyPanel={historyLineId ? <ServiceLineEditHistory scope={scope} sessionId={visit.id} lineId={historyLineId} timezone={visit.business_timezone} /> : null} />;
    })}
    {!access.denied && query.hasNextPage ? <Button type="button" variant="outline" onClick={() => { void query.fetchNextPage(); }}>{t(locale, 'serviceLineEdit.loadMore')}</Button> : null}
  </section>;
}
