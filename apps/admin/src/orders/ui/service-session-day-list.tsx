'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef } from 'react';
import type { UnresolvedCancel } from '../api/use-cancel-service-line';
import { CancelServiceLineDialog } from './cancel-service-line-dialog';
import type { ServiceSessionDayListProps } from './service-session-day-list-props';
import { ServiceSessionDayPerformers } from './service-session-day-performers';
import { ServiceSessionDayVisitSlot } from './service-session-day-visit-slot';
import { useDayLineActions } from './use-day-line-actions';
import { findLine, refreshLineTarget } from '../model/day-line-target';

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
    </>
  );
}
