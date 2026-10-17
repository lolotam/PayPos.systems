'use client';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { sessionLocalTime } from '../model/session-local-time';
import { useBrowserConnectivity } from '../model/use-browser-connectivity';
import { useSessionQueryLifecycle } from '../model/use-session-query-lifecycle';
import { ServiceSessionDayBody } from '../ui/service-session-day-body';
import { ServiceSessionDayFilters } from '../ui/service-session-day-filters';

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
  const onAccessDenied = useCallback((message: string) => { setDenied({ message }); }, []);
  // المسح بعد فك تركيب القائمة؛ لو اتمسح والكويري لسه متراقب TanStack بيعيد بناؤه ويجيبه من غير زر.
  useEffect(() => {
    if (!denied) return;
    client.removeQueries({ queryKey: ['branch-day-sessions', companyId, businessId, branchId, userId] });
    client.removeQueries({ queryKey: ['service-line-edits', companyId, businessId, branchId, userId] });
  }, [denied, client, companyId, businessId, branchId, userId]);
  return <section className="grid gap-4 text-start" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <PageHeader title={t(locale, 'serviceLineEdit.title')} />
    {connectivity === false ? <p role="status">{t(locale, 'serviceSessions.offline')}</p> : null}
    <ServiceSessionDayFilters date={date} lateOnly={lateOnly} onDate={setDate} onLate={setLateOnly} />
    {denied ? <p role="alert">{denied.message} <Button type="button" variant="outline" onClick={() => { setDenied(null); }}>{t(locale, 'serviceLineEdit.retry')}</Button></p>
      : <ServiceSessionDayBody scope={scope} date={date} lateOnly={lateOnly} online={online} timezone={timezone} onAccessDenied={onAccessDenied} />}
  </section>;
}
