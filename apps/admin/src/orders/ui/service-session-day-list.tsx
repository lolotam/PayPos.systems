'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, type RefObject } from 'react';
import type { UnresolvedCancel } from '../api/use-cancel-service-line';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { CancelServiceLineDialog } from './cancel-service-line-dialog';
import { ServiceLineCancellationDetails } from './service-line-cancellation-details';
import { ServiceLineEditHistory } from './service-line-edit-history';
import { ServiceSessionDayEditor } from './service-session-day-editor';
import {
  performerHistoryPanel,
  ServiceSessionDayPerformers,
} from './service-session-day-performers';
import { ServiceSessionDayVisit } from './service-session-day-visit';
import { SessionTipsLauncher } from './session-tips-launcher';
import { useDayLineActions } from './use-day-line-actions';
import { findLine, refreshLineTarget } from '../model/day-line-target';

type Visit = DayPage['items'][number];
type Pages = readonly DayPage[];
type Actions = ReturnType<typeof useDayLineActions>;
export type ServiceSessionDayListProps = {
  scope: SessionServiceScope;
  visits: Visit[];
  locale: Locale;
  online: boolean;
  timezone: string;
  canCancel: boolean;
  canRecord: boolean;
  loadError: string | null;
  empty: boolean;
  hasNext: boolean;
  onRetry: () => void;
  onMore: () => void;
  refetchPages: () => Promise<Pages | null>;
  mounted: RefObject<boolean>;
  onAccessDenied: (message: string) => void;
  tipAttempts?: RefObject<Map<string, UnresolvedTip>>;
};

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

function ServiceSessionDayVisitSlot({
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
      activeLineId={open?.line.id ?? null}
      historyLineId={historyLineId}
      detailsLineId={detailsLineId}
      performerHistoryLineId={performerHistoryLineId}
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

export function ServiceSessionDayList(props: ServiceSessionDayListProps) {
  const actions = useDayLineActions();
  const attempts = useRef(new Map<string, UnresolvedCancel>());
  const cancelKey = actions.cancelling;
  const cancelTarget = findLine(props.visits, cancelKey?.key ?? null);
  return (
    <>
      {actions.notice ? <p role="status">{actions.notice}</p> : null}
      {props.loadError ? (
        <p role="alert">
          {props.loadError}{' '}
          <Button type="button" variant="outline" onClick={props.onRetry}>
            {t(props.locale, 'serviceLineEdit.retry')}
          </Button>
        </p>
      ) : null}
      {props.empty ? <p>{t(props.locale, 'serviceLineEdit.empty')}</p> : null}
      {props.visits.map((visit) => (
        <ServiceSessionDayVisitSlot key={visit.id} visit={visit} list={props} actions={actions} />
      ))}
      {cancelTarget && cancelKey ? (
        <CancelServiceLineDialog
          key={cancelKey.token}
          scope={props.scope}
          sessionId={cancelTarget.visit.id}
          line={cancelTarget.line}
          online={props.online}
          onSaved={() => {
            actions.releaseCancel(cancelKey.key, cancelKey.token);
            actions.setNotice(t(props.locale, 'serviceLineCancel.saved'));
          }}
          onForbidden={(message) => {
            actions.releaseCancel(cancelKey.key, cancelKey.token);
            actions.setNotice(message);
          }}
          onAccessDenied={props.onAccessDenied}
          attempts={attempts}
          onRefresh={() => refreshLineTarget(props, cancelTarget.visit.id, cancelTarget.line.id)}
          onClose={() => {
            actions.releaseCancel(cancelKey.key, cancelKey.token);
          }}
        />
      ) : null}
      <ServiceSessionDayPerformers list={props} actions={actions} />
      {props.hasNext ? (
        <Button type="button" variant="outline" onClick={props.onMore}>
          {t(props.locale, 'serviceLineEdit.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
