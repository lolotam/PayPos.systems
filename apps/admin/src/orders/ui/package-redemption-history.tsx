'use client';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';

export function PackageRedemptionHistory({ scope, customerId, entitlementId }: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const detail = useCustomerPackageDetail(scope, customerId, open ? entitlementId : null);
  return <details className="grid gap-2 text-start" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t(locale, 'serviceSessions.packageHistory')}</summary>
    {open && detail.isLoading ? <p role="status">{t(locale, 'serviceSessions.packageLoading')}</p> : null}
    {open && detail.isError ? <p role="alert">{t(locale, 'serviceSessions.packageHistoryLoadFailed')}</p> : null}
    {open && detail.data?.redemptions.length === 0 ? <p role="status">{t(locale, 'serviceSessions.packageHistoryEmpty')}</p> : null}
    {open && detail.data && detail.data.redemptions.length > 0 ? <ol className="grid gap-2 ps-4">
      {detail.data.redemptions.map((redemption) => {
        const component = detail.data.components.find((row) => row.id === redemption.component_id);
        const serviceName = locale === 'ar' ? component?.name_ar ?? component?.name_en : component?.name_en;
        return <li key={redemption.id} className="grid gap-1">
          <span>{t(locale, 'serviceSessions.packageHistorySession').replace('{n}', String(redemption.ordinal))} {serviceName}</span>
          <span>{t(locale, 'serviceSessions.packageHistoryVisit').replace('{date}', '')}<bdi dir="ltr">{redemption.visit_business_date}</bdi></span>
          {redemption.reversed_at !== null ? <Badge>{t(locale, 'serviceSessions.packageHistoryReversed')}</Badge> : null}
        </li>;
      })}
    </ol> : null}
  </details>;
}
