'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchDaySessions } from '../api/use-branch-day-sessions';
import { useServiceSessionCapabilities } from '../api/use-service-session-capabilities';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import type { SessionServiceScope } from '../api/use-session-services';
import { sessionLocalTime } from '../model/session-local-time';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { ServiceSessionDayBody } from '../ui/service-session-day-body';
import { useTipAttemptMemory } from '../ui/use-tip-attempt-memory';
import { ServiceSessionDayFilters } from '../ui/service-session-day-filters';
import { ServiceSessionDayFrame } from '../ui/service-session-day-frame';
import { ServiceSessionDayLoadMore } from '../ui/service-session-day-load-more';

export function ServiceSessionDayPage({ scope, timezone }: { scope: SessionServiceScope; timezone: string }) {
  const locale = useLocale();
  const connectivity = useBrowserConnectivity();
  const online = connectivity === true;
  useSessionQueryLifecycle(scope, connectivity);
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  const [date, setDate] = useState(() => sessionLocalTime(new Date().toISOString(), timezone).slice(0, 10));
  const [lateOnly, setLateOnly] = useState(false);
  const [denied, setDenied] = useState<{ message: string } | null>(null);
  // القدرات الثلاثة من نفس القراءة، فبتتجاب دايماً وهي online؛ تجاوز واحدة منها كان بيوقف الاتنين التانيين (PP-19).
  const asked = online && denied === null;
  const capability = useServiceSessionCapabilities(scope, asked);
  // الصفحة تراقب استعلام اليوم نفسه (الجسم يراقبه أيضًا فلا طلب إضافي) كي تعرف الرفض والصفحة التالية في رندرها هي، لا من تأثير متأخر.
  const dayQuery = useBranchDaySessions(scope, date, lateOnly, asked);
  // زرار البقشيش من can_record_sessions، مش من نجاح قراءة سياق التسجيل: القراءة دي بقت مفتوحة لصلاحية تغيير المنفّذين (PP-19).
  // البيانات بتفضل بعد فشل إعادة جلب، فانقطاع مؤقت ما بيخفيش الزرار؛ 401/403 بيقفل الصفحة كلها.
  const canRecord = capability.data?.can_record_sessions === true;
  const tipAttempts = useTipAttemptMemory(companyId, businessId, branchId, userId);
  const cancelAllowed = capability.isSuccess && capability.data.can_cancel_lines === true;
  // زرار تغيير المنفّذين بيختفي عند اللي معندوش الصلاحية (PP-19.2)؛ السيرفر لسه بيرفض لو الصلاحية اتشالت بعد القراءة.
  const changeAllowed = capability.isSuccess && capability.data.can_change_performers === true;
  const onAccessDenied = useCallback((message: string) => { setDenied({ message }); }, []);
  // رفض القدرة 401/403/FEATURE_DISABLED معناه إن قراءة اليوم نفسها اتسحبت، مش الإلغاء بس؛ الشاشة تتقفل زي باقي القراءات.
  const dayRefused = serviceSessionAccessRevoked(dayQuery.error) ? { message: envelopeMessage(dayQuery.error, locale) } : null;
  const blocked = denied ?? (serviceSessionAccessRevoked(capability.error) ? { message: envelopeMessage(capability.error, locale) } : dayRefused);
  // مسح الاستعلامات يمحو خطأ الرفض من المراقب، فنثبّته في الحالة قبل المسح كي لا تنفتح الصفحة وحدها وتعيد القراءة المرفوضة.
  useEffect(() => { if (dayRefused && denied === null) setDenied(dayRefused); }, [dayRefused, denied]);
  // المسح بعد فك تركيب القائمة؛ لو اتمسح والكويري لسه متراقب TanStack بيعيد بناؤه ويجيبه من غير زر.
  const isBlocked = blocked !== null;
  useEffect(() => {
    if (!isBlocked) return;
    client.removeQueries({ queryKey: ['branch-day-sessions', companyId, businessId, branchId, userId] });
    client.removeQueries({ queryKey: ['service-line-edits', companyId, businessId, branchId, userId] });
    client.removeQueries({ queryKey: ['service-line-cancellations', companyId, businessId, branchId, userId] });
    client.removeQueries({ queryKey: ['service-line-performer-changes', companyId, businessId, branchId, userId] });
    client.removeQueries({ queryKey: ['session-tips', companyId, businessId, branchId, userId] });
  }, [isBlocked, client, companyId, businessId, branchId, userId]);
  const filters = <ServiceSessionDayFilters date={date} lateOnly={lateOnly} onDate={setDate} onLate={setLateOnly} />;
  return <PageShell layout="list" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageHeader title={t(locale, 'serviceLineEdit.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    <ServiceSessionDayFrame filters={filters} footer={!blocked && dayQuery.hasNextPage ? <ServiceSessionDayLoadMore onMore={dayQuery.fetchNextPage} /> : undefined}>
      {blocked ? <p role="alert">{blocked.message} <Button type="button" variant="outline" onClick={() => { setDenied(null); void capability.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p>
        : <ServiceSessionDayBody scope={scope} date={date} lateOnly={lateOnly} online={online} timezone={timezone} canCancel={cancelAllowed} canChangePerformers={changeAllowed} canRecord={canRecord} tipAttempts={tipAttempts} onAccessDenied={onAccessDenied} />}
    </ServiceSessionDayFrame>
  </PageShell>;
}
