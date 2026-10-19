'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { RefObject } from 'react';
import type { SessionServiceScope } from '../api/use-session-services';
import { CancelServiceLineDialog } from './cancel-service-line-dialog';
import { ServiceLineEditHistory } from './service-line-edit-history';
import { ServiceSessionDayEditor } from './service-session-day-editor';
import { ServiceSessionDayVisit } from './service-session-day-visit';
import { useDayLineActions } from './use-day-line-actions';

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
  loadError: string | null;
  empty: boolean;
  hasNext: boolean;
  onRetry: () => void;
  onMore: () => void;
  refetchPages: () => Promise<Pages | null>;
  mounted: RefObject<boolean>;
  onAccessDenied: (message: string) => void;
};

function findLine(visits: readonly Visit[], key: string | null) {
  if (!key) return null;
  for (const visit of visits) {
    const line = visit.lines.find((item) => `${visit.id}:${item.id}` === key);
    if (line) return { visit, line };
  }
  return null;
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
  const historyKey = actions.history;
  const historyLineId = historyKey?.startsWith(`${visit.id}:`)
    ? historyKey.slice(visit.id.length + 1)
    : null;
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
      onEdit={(lineId) => {
        actions.openEdit(visit.id, lineId);
      }}
      onCancel={(lineId) => {
        actions.openCancel(visit.id, lineId);
      }}
      onToggleHistory={(lineId) => {
        actions.toggleHistory(visit.id, lineId);
      }}
      editor={editor}
      historyPanel={
        historyLineId ? (
          <ServiceLineEditHistory
            scope={list.scope}
            sessionId={visit.id}
            lineId={historyLineId}
            timezone={visit.business_timezone || list.timezone}
            onAccessDenied={list.onAccessDenied}
          />
        ) : null
      }
    />
  );
}

export function ServiceSessionDayList(props: ServiceSessionDayListProps) {
  const actions = useDayLineActions();
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
          onClose={() => {
            actions.releaseCancel(cancelKey.key, cancelKey.token);
          }}
        />
      ) : null}
      {props.hasNext ? (
        <Button type="button" variant="outline" onClick={props.onMore}>
          {t(props.locale, 'serviceLineEdit.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
