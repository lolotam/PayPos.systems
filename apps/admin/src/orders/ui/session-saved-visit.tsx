'use client';
import type { ServiceSession } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { EditServiceLineResult } from '../api/use-edit-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { applySavedLineEdit, emptySavedVisit, reconcileSavedVisit, type SavedVisitEdit } from '../model/session-saved-edit';
import { sessionResultFrozen, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionSavedLine } from './session-saved-line';

const kwd = (value: string) => formatKwd(parseMoney(value));
type Held = { snapshot: ServiceSession; visit: SavedVisitEdit };
type OpenLine = { snapshot: ServiceSession; lineId: string };
type Refusal = { snapshot: ServiceSession; message: string };
type Denial = { sessionId: string; message: string };

export function SessionSavedVisit({ result, scope, online }: {
  result: SessionRecordingResult; scope?: SessionServiceScope; online: boolean;
}) {
  const locale = useLocale();
  const session = result.session;
  const [held, setHeld] = useState<Held | null>(null);
  const [open, setOpen] = useState<OpenLine | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [denial, setDenial] = useState<Denial | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  // 401 وإيقاف الميزة بيقفلوا الأرقام؛ الإلحاق نفس id فما يرجعهاش، وزيارة بـ id جديد تبدأ من غير الرفض.
  const denied = denial?.sessionId === session.id ? denial.message : null;
  if (denied) return <p role="alert">{denied}</p>;
  // نفس id بعد الإلحاق يحتفظ بالعلامة. الفورم المفتوح يتقفل لأن مراجعته اتكتبت على السناب شوت السابق.
  const baseline = held?.visit ?? emptySavedVisit(session.id, session.total_net);
  const visit = held?.snapshot === session ? held.visit : reconcileSavedVisit(baseline, session);
  const canEdit = !!scope && !sessionResultFrozen(result);
  const editingId = canEdit && open?.snapshot === session ? open.lineId : null;
  const refusalText = refusal?.snapshot === session ? refusal.message : null;
  const when = formatInstant(new Date(session.occurred_at), locale, session.business_timezone);
  const saved = (lineId: string, edit: EditServiceLineResult) => {
    // الطلبات بتتسلسل، والدمج على الحالة الحالية عشان رد متأخر ما يقفلش محرر غير محرره.
    setHeld((current) => {
      const base = current?.snapshot === session ? current.visit
        : reconcileSavedVisit(current?.visit ?? emptySavedVisit(session.id, session.total_net), session);
      return { snapshot: session, visit: applySavedLineEdit(base, session.id, lineId, edit.response, edit.revisionUsed) };
    });
    setOpen((current) => current?.lineId === lineId && current.snapshot === session ? null : current);
  };
  return <>
    {visit.total === 'UNKNOWN' ? null : <p>{t(locale, 'serviceSessions.savedTotal')} <bdi>{kwd(visit.total === 'FROM_RESPONSE' ? visit.totalNet : session.total_net)}</bdi></p>}
    {refusalText ? <p role="alert">{refusalText}</p> : null}
    <ul className="grid gap-3">{session.lines.map((line) => {
      const edit = visit.lines[line.id];
      return <SessionSavedLine key={line.id} line={line} locale={locale} when={when} sessionId={session.id} online={online}
        open={editingId === line.id} canEdit={canEdit} added={result.addedLineIds.includes(line.id)} busy={busy} onBusyChange={setBusy}
        {...(edit ? { edit } : {})} {...(scope ? { scope } : {})}
        onOpen={() => { if (busy) return; setRefusal(null); setOpen({ snapshot: session, lineId: line.id }); }} onClose={() => setOpen(null)}
        onSaved={(savedEdit) => saved(line.id, savedEdit)} onForbidden={(message) => { setRefusal({ snapshot: session, message }); setOpen(null); }}
        onAccessDenied={(message) => { setDenial({ sessionId: session.id, message }); setOpen(null); }} />;
    })}</ul>
  </>;
}
