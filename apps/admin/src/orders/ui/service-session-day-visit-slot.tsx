'use client';
import { ServiceLineCancellationDetails } from './service-line-cancellation-details';
import { ServiceLineEditHistory } from './service-line-edit-history';
import { ServiceSessionDayEditor } from './service-session-day-editor';
import type { ServiceSessionDayListProps, Visit } from './service-session-day-list-props';
import { performerHistoryPanel } from './service-session-day-performers';
import { ServiceSessionDayVisit } from './service-session-day-visit';
import { SessionTipsLauncher } from './session-tips-launcher';
import type { useDayLineActions } from './use-day-line-actions';
import { findLine } from '../model/day-line-target';

type Actions = ReturnType<typeof useDayLineActions>;

function keyedLine(visitId: string, key: string | null) {
  return key?.startsWith(`${visitId}:`) ? key.slice(visitId.length + 1) : null;
}

function historyPanel(list: ServiceSessionDayListProps, visit: Visit, lineId: string) {
  return (
    <ServiceLineEditHistory
      scope={list.scope}
      sessionId={visit.id}
      lineId={lineId}
      timezone={visit.business_timezone || list.timezone}
      onAccessDenied={list.onAccessDenied}
    />
  );
}

function cancellationPanel(list: ServiceSessionDayListProps, visit: Visit, lineId: string) {
  return (
    <ServiceLineCancellationDetails
      scope={list.scope}
      sessionId={visit.id}
      lineId={lineId}
      timezone={visit.business_timezone || list.timezone}
      onAccessDenied={list.onAccessDenied}
    />
  );
}

function visitTips(
  list: ServiceSessionDayListProps,
  visit: Visit,
  onForbidden: (message: string) => void,
) {
  if (!list.canRecord) return null;
  return (
    <SessionTipsLauncher
      scope={list.scope}
      sessionId={visit.id}
      lines={visit.lines}
      online={list.online}
      {...(list.tipAttempts ? { memory: list.tipAttempts } : {})}
      onForbidden={onForbidden}
      onAccessDenied={list.onAccessDenied}
    />
  );
}

export function ServiceSessionDayVisitSlot({
  visit,
  list,
  actions,
}: {
  visit: Visit;
  list: ServiceSessionDayListProps;
  actions: Actions;
}) {
  const editing = actions.editing;
  const open = findLine([visit], editing?.key ?? null);
  const historyLineId = keyedLine(visit.id, actions.history);
  const detailsLineId = keyedLine(visit.id, actions.details);
  const performerHistoryLineId = keyedLine(visit.id, actions.performerHistory);
  const editor =
    open && editing ? (
      <ServiceSessionDayEditor
        visitId={visit.id}
        line={open.line}
        list={list}
        editing={editing}
        releaseEdit={actions.releaseEdit}
        setNotice={actions.setNotice}
      />
    ) : null;
  return (
    <ServiceSessionDayVisit
      visit={visit}
      locale={list.locale}
      zoneFallback={list.timezone}
      canCancel={list.canCancel}
      canChangePerformers={list.canChangePerformers}
      activeLineId={open?.line.id ?? null}
      historyLineId={historyLineId}
      detailsLineId={detailsLineId}
      performerHistoryLineId={performerHistoryLineId}
      packagesScope={list.scope}
      handlers={{
        onEdit: (lineId) => actions.openEdit(visit.id, lineId),
        onCancel: (lineId) => actions.openCancel(visit.id, lineId),
        onChangePerformers: (lineId) => actions.openPerformers(visit.id, lineId),
        onToggleHistory: (lineId) => actions.toggleHistory(visit.id, lineId),
        onToggleDetails: (lineId) => actions.toggleDetails(visit.id, lineId),
        onTogglePerformerHistory: (lineId) => actions.togglePerformerHistory(visit.id, lineId),
      }}
      tipAction={visitTips(list, visit, actions.setNotice)}
      panels={{
        editor,
        historyPanel: historyLineId ? historyPanel(list, visit, historyLineId) : null,
        detailsPanel: detailsLineId ? cancellationPanel(list, visit, detailsLineId) : null,
        performerHistoryPanel: performerHistoryLineId
          ? performerHistoryPanel(list, visit, performerHistoryLineId)
          : null,
      }}
    />
  );
}
