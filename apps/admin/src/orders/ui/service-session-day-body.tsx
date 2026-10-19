'use client';
import { useEffect, useRef } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { ServiceSessionDayList } from './service-session-day-list';

export function ServiceSessionDayBody({
  scope,
  date,
  lateOnly,
  online,
  timezone,
  canCancel,
  onAccessDenied,
}: {
  scope: SessionServiceScope;
  date: string;
  lateOnly: boolean;
  online: boolean;
  timezone: string;
  canCancel: boolean;
  onAccessDenied: (message: string) => void;
}) {
  const locale = useLocale();
  const mounted = useRef(true);
  const query = useBranchDaySessions(scope, date, lateOnly, online);
  const revoked = serviceSessionAccessRevoked(query.error);
  // رد 409 متأخر بعد ما الجسم اتفك (رفض وصول) ممنوع يعيد بناء استعلام اتمسح قبل ما الـ Retry ينجح.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // الكاش بيفضل موجود مع الخطأ؛ الرجوع فاضي في نفس الرندر يمنع لمعان الأسماء قبل ما الصفحة الأم تتشال.
  useEffect(() => {
    if (revoked) onAccessDenied(envelopeMessage(query.error, locale));
  }, [revoked, query.error, locale, onAccessDenied]);
  if (revoked) return null;
  const visits = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ServiceSessionDayList
      scope={scope}
      visits={visits}
      locale={locale}
      online={online}
      timezone={timezone}
      canCancel={canCancel}
      loadError={query.isError ? envelopeMessage(query.error, locale) : null}
      empty={query.isSuccess && visits.length === 0}
      hasNext={query.hasNextPage === true}
      onRetry={() => {
        void query.refetch();
      }}
      onMore={() => {
        void query.fetchNextPage();
      }}
      refetchPages={async () => {
        const fresh = await query.refetch();
        return fresh.isSuccess ? fresh.data.pages : null;
      }}
      mounted={mounted}
      onAccessDenied={onAccessDenied}
    />
  );
}
