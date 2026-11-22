'use client';
import { useEffect, useRef, type RefObject } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { ServiceSessionDayList } from './service-session-day-list';

type ServiceSessionDayBodyProps = {
  scope: SessionServiceScope;
  date: string;
  lateOnly: boolean;
  online: boolean;
  timezone: string;
  canCancel: boolean;
  canChangePerformers: boolean;
  canRecord: boolean;
  onAccessDenied: (message: string) => void;
  tipAttempts: RefObject<Map<string, UnresolvedTip>>;
};

export function ServiceSessionDayBody({
  scope,
  date,
  lateOnly,
  online,
  timezone,
  canCancel,
  canChangePerformers,
  canRecord,
  onAccessDenied,
  tipAttempts,
}: ServiceSessionDayBodyProps) {
  const locale = useLocale();
  const mounted = useRef(true);
  const query = useBranchDaySessions(scope, date, lateOnly, online);
  // رفض الوصول على قراءة اليوم تلتقطه الصفحة من نفس الاستعلام في رندرها هي، فلا يبقى هذا الجسم ولا تذييله لحظة بعده.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const visits = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ServiceSessionDayList
      scope={scope}
      visits={visits}
      locale={locale}
      online={online}
      timezone={timezone}
      canCancel={canCancel}
      canChangePerformers={canChangePerformers}
      canRecord={canRecord}
      loadError={query.isError ? envelopeMessage(query.error, locale) : null}
      empty={query.isSuccess && visits.length === 0}
      onRetry={() => {
        void query.refetch();
      }}
      refetchPages={async () => {
        const fresh = await query.refetch();
        return fresh.isSuccess ? fresh.data.pages : null;
      }}
      mounted={mounted}
      onAccessDenied={onAccessDenied}
      tipAttempts={tipAttempts}
    />
  );
}
