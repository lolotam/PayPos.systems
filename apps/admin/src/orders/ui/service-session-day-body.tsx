'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { EditServiceLineForm } from './edit-service-line-form';
import { ServiceLineEditHistory } from './service-line-edit-history';
import { ServiceSessionDayVisit } from './service-session-day-visit';

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

function findLine(visits: Visit[], key: string | null) {
  if (!key) return null;
  for (const visit of visits) {
    const line = visit.lines.find((item) => `${visit.id}:${item.id}` === key);
    if (line) return { visit, line };
  }
  return null;
}

export function ServiceSessionDayBody({ scope, date, lateOnly, online, timezone, onAccessDenied }: {
  scope: SessionServiceScope; date: string; lateOnly: boolean; online: boolean; timezone: string;
  onAccessDenied: (message: string) => void;
}) {
  const locale = useLocale();
  const editorToken = useRef(0);
  const [editing, setEditing] = useState<OpenEditor | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const query = useBranchDaySessions(scope, date, lateOnly, online);
  const revoked = serviceSessionAccessRevoked(query.error);
  // الكاش بيفضل موجود مع الخطأ؛ الرجوع فاضي في نفس الرندر يمنع لمعان الأسماء قبل ما الصفحة الأم تتشال.
  useEffect(() => {
    if (revoked) onAccessDenied(envelopeMessage(query.error, locale));
  }, [revoked, query.error, locale, onAccessDenied]);
  if (revoked) return null;
  const visits = query.data?.pages.flatMap((page) => page.items) ?? [];
  const target = findLine(visits, editing?.key ?? null);
  return <>
    {notice ? <p role="status">{notice}</p> : null}
    {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)} <Button type="button" variant="outline" onClick={() => { void query.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p> : null}
    {query.isSuccess && visits.length === 0 ? <p>{t(locale, 'serviceLineEdit.empty')}</p> : null}
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
          onAccessDenied={onAccessDenied} onClose={() => { setEditing(releaseEditor(lineKey, openToken)); }} /> : null}
        historyPanel={historyLineId ? <ServiceLineEditHistory scope={scope} sessionId={visit.id} lineId={historyLineId} timezone={visit.business_timezone || timezone} onAccessDenied={onAccessDenied} /> : null} />;
    })}
    {query.hasNextPage ? <Button type="button" variant="outline" onClick={() => { void query.fetchNextPage(); }}>{t(locale, 'serviceLineEdit.loadMore')}</Button> : null}
  </>;
}
