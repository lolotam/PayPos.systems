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

function nextHeldAfterLineSave(current: Held | null, latest: ServiceSession, lineId: string, edit: EditServiceLineResult, sameEpoch = true): Held {
  const answered = 'line' in edit.response ? edit.response.line.revision : edit.revisionUsed + 1;
  const effective: EditServiceLineResult = sameEpoch
    ? edit
    : { response: { saved: true, edited: true }, revisionUsed: answered - 1 };
  const base = current?.snapshot === latest ? current.visit : reconcileSavedVisit(current?.visit ?? emptySavedVisit(latest.id, latest.total_net), latest);
  const snapshotRevision = latest.lines.find((line) => line.id === lineId)?.revision ?? 0;
  if (snapshotRevision >= answered) {
    if ((base.lines[lineId]?.revision ?? 0) > snapshotRevision) return { snapshot: latest, visit: base };
    return { snapshot: latest, visit: { ...base, lines: { ...base.lines, [lineId]: { edited: true, revision: snapshotRevision, figures: 'SNAPSHOT' } } } };
  }
  return { snapshot: latest, visit: applySavedLineEdit(base, latest.id, lineId, effective.response, effective.revisionUsed) };
}

function redactHeldFigures(current: Held | null): Held | null {
  if (!current) return null;
  const lines = Object.fromEntries(Object.entries(current.visit.lines).map(([lineId, edit]) => [
    lineId,
    edit.figures === 'FROM_RESPONSE' ? { edited: true as const, revision: edit.revision, figures: 'UNKNOWN' as const } : edit,
  ]));
  const total = current.visit.total === 'FROM_RESPONSE' ? 'UNKNOWN' : current.visit.total;
  return { snapshot: current.snapshot, visit: { ...current.visit, total, lines } };
}

function useSavedVisitState(session: ServiceSession | null, scope: SessionServiceScope | undefined, editBusy: boolean) {
  const scopeKey = session ? visitScopeKey(scope, session.id) : '';
  const [activation, setActivation] = useState(() => ({ scopeKey, epoch: 1 }));
  const [held, setHeld] = useState<Held | null>(null);
  const [open, setOpen] = useState<OpenLine | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [denial, setDenial] = useState<string | null>(null);
  let epoch = activation.epoch;
  if (activation.scopeKey !== scopeKey) {
    epoch = activation.epoch + 1;
    setActivation({ scopeKey, epoch });
    setOpen(null);
    setRefusal(null);
    setDenial(null);
    setHeld((current) => (current && session && current.snapshot.id === session.id ? redactHeldFigures(current) : null));
  }
  const sessionRef = useRef(session);
  const activeEpochRef = useRef<number | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { activeEpochRef.current = epoch; return () => { activeEpochRef.current = null; }; }, [epoch]);
  if (editBusy && session && open && open.snapshot.id === session.id && open.snapshot !== session) setOpen({ snapshot: session, lineId: open.lineId });
  const closeLine = (targetEpoch: number, lineId?: string) => {
    if (activeEpochRef.current !== null && activeEpochRef.current !== targetEpoch) return;
    setOpen((current) => (!lineId || current?.lineId === lineId ? null : current));
  };
  const reportForbidden = (targetEpoch: number, message: string, lineId?: string) => {
    if (activeEpochRef.current !== null && activeEpochRef.current !== targetEpoch) return;
    setRefusal(message);
    if (lineId) closeLine(targetEpoch, lineId);
  };
  const reportDenied = (targetEpoch: number, message: string) => {
    if (activeEpochRef.current !== null && activeEpochRef.current !== targetEpoch) return;
    setDenial(message);
    setOpen(null);
  };
  const saved = (targetEpoch: number, lineId: string, edit: EditServiceLineResult) => {
    const latest = sessionRef.current ?? session;
    if (!latest || latest.id !== session?.id) return;
    const sameEpoch = activeEpochRef.current === null || activeEpochRef.current === targetEpoch;
    setHeld((current) => nextHeldAfterLineSave(current, latest, lineId, edit, sameEpoch));
    if (sameEpoch) closeLine(targetEpoch, lineId);
  };
  return { scopeKey, epoch, held, open, setOpen, refusal, setRefusal, denial, closeLine, reportForbidden, reportDenied, saved };
}

export function SessionSavedVisit({ result, scope, online, editBusy = false, tipMemory: externalTipMemory, onRequestStart, onRequestEnd }: {
  result: SessionRecordingResult; scope?: SessionServiceScope; online: boolean;
  editBusy?: boolean; tipMemory?: RefObject<Map<string, UnresolvedTip>>; onRequestStart?: () => void; onRequestEnd?: () => void;
}) {
  const locale = useLocale();
  const session = result.session;
  const ownTipMemory = useTipAttemptMemory(scope?.companyId ?? '', scope?.businessId ?? '', scope?.branchId ?? '', scope?.userId ?? '');
  const tipMemory = externalTipMemory ?? ownTipMemory;
  const { scopeKey, epoch, held, open, setOpen, refusal, setRefusal, denial, closeLine, reportForbidden, reportDenied, saved } = useSavedVisitState(session, scope, editBusy);
  if (!session) return null;
  if (denial) return <p role="alert">{denial}</p>;
  const baseline = held?.visit ?? emptySavedVisit(session.id, session.total_net);
  const visit = held?.snapshot === session ? held.visit : reconcileSavedVisit(baseline, session);
  const canEdit = !!scope && !sessionResultFrozen(result);
  const editingId = openLineId(open, session, canEdit, editBusy);
  const when = formatInstant(new Date(session.occurred_at), locale, session.business_timezone);
  return <>
    {visit.total === 'UNKNOWN' ? null : <p>{t(locale, 'serviceSessions.savedTotal')} <bdi>{kwd(visit.total === 'FROM_RESPONSE' ? visit.totalNet : session.total_net)}</bdi></p>}
    {refusal ? <p role="alert">{refusal}</p> : null}
    {scope ? <SessionTipsLauncher key={`${scopeKey}:${epoch}`} scope={scope} sessionId={session.id} memory={tipMemory} {...savedVisitTipSource(session.lines, visit)} online={online} disabled={editBusy} onForbidden={(message) => reportForbidden(epoch, message)} onAccessDenied={(message) => reportDenied(epoch, message)} /> : null}
    <ul className="grid gap-3">{session.lines.map((line) => {
      const edit = visit.lines[line.id];
      return <SessionSavedLine key={`${scopeKey}:${epoch}:${line.id}`} line={line} locale={locale} when={when} sessionId={session.id} online={online}
        open={editingId === line.id} canEdit={canEdit} added={result.addedLineIds.includes(line.id)} editBusy={editBusy}
        {...(edit ? { edit } : {})} {...(scope ? { scope } : {})} {...(onRequestStart ? { onRequestStart } : {})} {...(onRequestEnd ? { onRequestEnd } : {})}
        onOpen={() => { if (editBusy) return; setRefusal(null); setOpen({ snapshot: session, lineId: line.id }); }} onClose={() => closeLine(epoch, line.id)}
        onSaved={(savedEdit) => saved(epoch, line.id, savedEdit)} onForbidden={(message) => reportForbidden(epoch, message, line.id)}
        onAccessDenied={(message) => reportDenied(epoch, message)} />;
    })}</ul>
  </>;
}
