'use client';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import type { UnresolvedTip } from '../api/use-record-session-tips';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
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
  /** شريط التاريخ والتأخير داخل كرت القائمة فوق الزيارات، يبقى ظاهرًا مع رفض الوصول. */
  filters: ReactNode;
};

// كرت واحد للتصفية والزيارات وزر «المزيد»؛ الزيارات نفسها كروت داخله، فالحشوة والفجوة هنا.
function DayFrame({
  filters,
  footer,
  children,
}: {
  filters: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <DataTableFrame filters={filters} footer={footer}>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </DataTableFrame>
  );
}

function DayLoadMore({ onMore }: { onMore: () => Promise<unknown> }) {
  const locale = useLocale();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void onMore();
      }}
    >
      {t(locale, 'serviceLineEdit.loadMore')}
    </Button>
  );
}

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
  filters,
}: ServiceSessionDayBodyProps) {
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
  if (revoked) return <DayFrame filters={filters} />;
  const visits = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <DayFrame
      filters={filters}
      footer={query.hasNextPage === true ? <DayLoadMore onMore={query.fetchNextPage} /> : undefined}
    >
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
    </DayFrame>
  );
}
