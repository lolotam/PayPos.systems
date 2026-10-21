'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useServiceSessionCapabilities } from '../api/use-service-session-capabilities';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import type { SessionServiceScope } from '../api/use-session-services';
import { sessionLocalTime } from '../model/session-local-time';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { ServiceSessionDayBody } from '../ui/service-session-day-body';
import { useTipAttemptMemory } from '../ui/use-tip-attempt-memory';
import { ServiceSessionDayFilters } from '../ui/service-session-day-filters';

export function ServiceSessionDayPage({ scope, timezone, canCancel, canChangePerformers }: { scope: SessionServiceScope; timezone: string; canCancel?: boolean; canChangePerformers?: boolean }) {
  const locale = useLocale();
  const connectivity = useBrowserConnectivity();
  const online = connectivity === true;
  useSessionQueryLifecycle(scope, connectivity);
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  const [date, setDate] = useState(() => sessionLocalTime(new Date().toISOString(), timezone).slice(0, 10));
  const [lateOnly, setLateOnly] = useState(false);
  const [denied, setDenied] = useState<{ message: string } | null>(null);
  const asked = canCancel === undefined && online && denied === null;
  const capability = useServiceSessionCapabilities(scope, asked);
  // زرار البقشيش من can_record_sessions، مش من نجاح قراءة سياق التسجيل: القراءة دي بقت مفتوحة لصلاحية تغيير المنفّذين (PP-19).
  // البيانات بتفضل بعد فشل إعادة جلب، فانقطاع مؤقت ما بيخفيش الزرار؛ 401/403 بيقفل الصفحة كلها.
  const canRecord = capability.data?.can_record_sessions === true;
  const tipAttempts = useTipAttemptMemory(companyId, businessId, branchId, userId);
  const cancelAllowed = canCancel ?? (capability.isSuccess && capability.data.can_cancel_lines === true);
  // زرار تغيير المنفّذين بيختفي عند اللي معندوش الصلاحية (PP-19.2)؛ السيرفر لسه بيرفض لو الصلاحية اتشالت بعد القراءة.
  const changeAllowed = canChangePerformers ?? (capability.isSuccess && capability.data.can_change_performers === true);
  const onAccessDenied = useCallback((message: string) => { setDenied({ message }); }, []);
  // رفض القدرة 401/403/FEATURE_DISABLED معناه إن قراءة اليوم نفسها اتسحبت، مش الإلغاء بس؛ الشاشة تتقفل زي باقي القراءات.
  const blocked = denied ?? (serviceSessionAccessRevoked(capability.error) ? { message: envelopeMessage(capability.error, locale) } : null);
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
  return <section className="grid gap-4 text-start" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageHeader title={t(locale, 'serviceLineEdit.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    <ServiceSessionDayFilters date={date} lateOnly={lateOnly} onDate={setDate} onLate={setLateOnly} />
    {blocked ? <p role="alert">{blocked.message} <Button type="button" variant="outline" onClick={() => { setDenied(null); void capability.refetch(); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p>
      : <ServiceSessionDayBody scope={scope} date={date} lateOnly={lateOnly} online={online} timezone={timezone} canCancel={cancelAllowed} canChangePerformers={changeAllowed} canRecord={canRecord} tipAttempts={tipAttempts} onAccessDenied={onAccessDenied} />}
  </section>;
}
