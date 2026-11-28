'use client';
import type { ServiceSession } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatInstant, formatKwd, t } from '@pospay/i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { EditServiceLineResult } from '../api/use-edit-service-line';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { applySavedLineEdit, emptySavedVisit, reconcileSavedVisit, type SavedVisitEdit } from '../model/session-saved-edit';
import { savedVisitTipSource } from '../model/session-saved-tip-source';
import { sessionResultFrozen, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionSavedLine } from './session-saved-line';
import { SessionTipsLauncher } from './session-tips-launcher';
import { useTipAttemptMemory } from './use-tip-attempt-memory';

const kwd = (value: string) => formatKwd(parseMoney(value));
type Held = { snapshot: ServiceSession; visit: SavedVisitEdit };
type OpenLine = { snapshot: ServiceSession; lineId: string };

function openLineId(open: OpenLine | null, session: ServiceSession, canEdit: boolean, editBusy: boolean) {
  if (!open || open.snapshot.id !== session.id) return null;
  // مفتاح الإعادة عايش جوّه المحرر. استبدال سناب شوت نفس الزيارة وهو معلّق بيضيّعه والقفل يفضل مرفوع.
  if (editBusy) return open.lineId;
  return canEdit && open.snapshot === session ? open.lineId : null;
}
function visitScopeKey(scope: SessionServiceScope | undefined, sessionId: string) {
  return `${scope?.companyId ?? ''}:${scope?.businessId ?? ''}:${scope?.branchId ?? ''}:${scope?.userId ?? ''}:${sessionId}`;
}

function nextHeldAfterLineSave(current: Held | null, latest: ServiceSession, lineId: string, edit: EditServiceLineResult): Held {
  const answered = 'line' in edit.response ? edit.response.line.revision : edit.revisionUsed + 1;
  const snapshotRevision = latest.lines.find((line) => line.id === lineId)?.revision ?? 0;
  if (snapshotRevision >= answered) {
    const base = reconcileSavedVisit(current?.visit ?? emptySavedVisit(latest.id, latest.total_net), latest);
    return { snapshot: latest, visit: { ...base, lines: { ...base.lines, [lineId]: { edited: true, revision: snapshotRevision, figures: 'SNAPSHOT' } } } };
  }
  const base = current?.snapshot === latest ? current.visit : reconcileSavedVisit(current?.visit ?? emptySavedVisit(latest.id, latest.total_net), latest);
  return { snapshot: latest, visit: applySavedLineEdit(base, latest.id, lineId, edit.response, edit.revisionUsed) };
}

type ScopedAlert = { key: string; message: string };

export function SessionSavedVisit({ result, scope, online, editBusy = false, tipMemory: externalTipMemory, onRequestStart, onRequestEnd }: {
  result: SessionRecordingResult; scope?: SessionServiceScope; online: boolean;
  editBusy?: boolean; tipMemory?: RefObject<Map<string, UnresolvedTip>>; onRequestStart?: () => void; onRequestEnd?: () => void;
}) {
  const locale = useLocale();
  const session = result.session;
  const [held, setHeld] = useState<Held | null>(null);
  const [open, setOpen] = useState<OpenLine | null>(null);
  const [refusal, setRefusal] = useState<ScopedAlert | null>(null);
  const [denial, setDenial] = useState<ScopedAlert | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const currentKey = session ? visitScopeKey(scope, session.id) : '';
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => { activeKeyRef.current = currentKey; }, [currentKey]);
  const ownTipMemory = useTipAttemptMemory(scope?.companyId ?? '', scope?.businessId ?? '', scope?.branchId ?? '', scope?.userId ?? '');
  const tipMemory = externalTipMemory ?? ownTipMemory;
  // المحرر المعلّق اللي اتبقّى بعد استبدال السناب شوت يتثبّت على الجديد، فرفض معروف بعد القفل يفضل ظاهر مش بيختفي.
  if (editBusy && session && open && open.snapshot.id === session.id && open.snapshot !== session) setOpen({ snapshot: session, lineId: open.lineId });
  if (!session) return null;
  // 401 وإيقاف الميزة بيقفلوا الأرقام على نفس المشغّل والزيارة فقط؛ تغيير المشغّل أو زيارة جديدة يبدأ من غير الرفض.
  const denied = denial?.key === currentKey ? denial.message : null;
  if (denied) return <p role="alert">{denied}</p>;
  // نفس id بعد الإلحاق يحتفظ بالعلامة. المحرر الفاضي بيتقفل لأن مراجعته اتكتبت على السناب شوت السابق.
  const baseline = held?.visit ?? emptySavedVisit(session.id, session.total_net);
  const visit = held?.snapshot === session ? held.visit : reconcileSavedVisit(baseline, session);
  const canEdit = !!scope && !sessionResultFrozen(result);
  const editingId = openLineId(open, session, canEdit, editBusy);
  const refusalText = refusal?.key === currentKey ? refusal.message : null;
  const when = formatInstant(new Date(session.occurred_at), locale, session.business_timezone);
  const reportForbidden = (targetKey: string, message: string, closeLine = false) => {
    if (activeKeyRef.current !== null && activeKeyRef.current !== targetKey) return;
    setRefusal({ key: targetKey, message });
    if (closeLine) setOpen(null);
  };
  const reportDenied = (targetKey: string, message: string) => {
    if (activeKeyRef.current !== null && activeKeyRef.current !== targetKey) return;
    setDenial({ key: targetKey, message });
    setOpen(null);
  };
  const saved = (lineId: string, edit: EditServiceLineResult) => {
    // رد طلب بدأ على زيارة تانية ما يتحسبش على الزيارة الحالية.
    const latest = sessionRef.current ?? session;
    if (latest.id !== session.id) return;
    setHeld((current) => nextHeldAfterLineSave(current, latest, lineId, edit));
    setOpen((current) => current?.lineId === lineId ? null : current);
  };
  return <>
    {visit.total === 'UNKNOWN' ? null : <p>{t(locale, 'serviceSessions.savedTotal')} <bdi>{kwd(visit.total === 'FROM_RESPONSE' ? visit.totalNet : session.total_net)}</bdi></p>}
    {refusalText ? <p role="alert">{refusalText}</p> : null}
    {scope ? <SessionTipsLauncher key={currentKey} scope={scope} sessionId={session.id} memory={tipMemory} {...savedVisitTipSource(session.lines, visit)} online={online} disabled={editBusy} onForbidden={(message) => reportForbidden(currentKey, message)} onAccessDenied={(message) => reportDenied(currentKey, message)} /> : null}
    <ul className="grid gap-3">{session.lines.map((line) => {
      const edit = visit.lines[line.id];
      return <SessionSavedLine key={line.id} line={line} locale={locale} when={when} sessionId={session.id} online={online}
        open={editingId === line.id} canEdit={canEdit} added={result.addedLineIds.includes(line.id)} editBusy={editBusy}
        {...(edit ? { edit } : {})} {...(scope ? { scope } : {})} {...(onRequestStart ? { onRequestStart } : {})} {...(onRequestEnd ? { onRequestEnd } : {})}
        onOpen={() => { if (editBusy) return; setRefusal(null); setOpen({ snapshot: session, lineId: line.id }); }} onClose={() => setOpen(null)}
        onSaved={(savedEdit) => saved(line.id, savedEdit)} onForbidden={(message) => reportForbidden(currentKey, message, true)}
        onAccessDenied={(message) => reportDenied(currentKey, message)} />;
    })}</ul>
  </>;
}
