'use client';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useRef, type RefObject } from 'react';
import type { UnresolvedPerformersChange } from '../api/use-change-line-performers';
import type { SessionServiceScope } from '../api/use-session-services';
import { findLine, refreshLineTarget } from '../model/day-line-target';
import { ChangeLinePerformersDialog } from './change-line-performers-dialog';
import { ServiceLinePerformerHistory } from './service-line-performer-history';

type Visit = DayPage['items'][number];
type PerformersList = {
  scope: SessionServiceScope;
  visits: Visit[];
  locale: Locale;
  online: boolean;
  timezone: string;
  mounted: RefObject<boolean>;
  refetchPages: () => Promise<readonly DayPage[] | null>;
  onAccessDenied: (message: string) => void;
};
type PerformersActions = {
  changingPerformers: { key: string; token: number } | null;
  releasePerformers: (key: string, token: number) => void;
  setNotice: (message: string) => void;
};

export function performerHistoryPanel(list: PerformersList, visit: Visit, lineId: string) {
  return (
    <ServiceLinePerformerHistory
      scope={list.scope}
      sessionId={visit.id}
      lineId={lineId}
      timezone={visit.business_timezone || list.timezone}
      onAccessDenied={list.onAccessDenied}
    />
  );
}

// الحوار متركّب برّه الزيارة، والمحاولات المجهولة محفوظة هنا، عشان قفل الحوار أو جلب اليوم ما يضيّعش مفتاح الطلب.
export function ServiceSessionDayPerformers({
  list,
  actions,
}: {
  list: PerformersList;
  actions: PerformersActions;
}) {
  const attempts = useRef(new Map<string, UnresolvedPerformersChange>());
  const opened = actions.changingPerformers;
  const target = findLine(list.visits, opened?.key ?? null);
  if (!target || !opened) return null;
  const release = () => actions.releasePerformers(opened.key, opened.token);
  return (
    <ChangeLinePerformersDialog
      key={opened.token}
      scope={list.scope}
      sessionId={target.visit.id}
      line={target.line}
      occurredAt={target.visit.occurred_at}
      online={list.online}
      attempts={attempts}
      onSaved={() => {
        release();
        actions.setNotice(t(list.locale, 'serviceLinePerformers.saved'));
      }}
      onForbidden={(message) => {
        release();
        actions.setNotice(message);
      }}
      onAccessDenied={list.onAccessDenied}
      onRefresh={() => refreshLineTarget(list, target.visit.id, target.line.id)}
      onClose={release}
    />
  );
}
