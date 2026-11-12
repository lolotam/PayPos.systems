'use client';
import { t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';
import { ExtendPackageDialog } from './extend-package-dialog';
import { PackageExtensionHistory } from './package-extension-history';

export function PackageRedemptionHistory({ scope, customerId, entitlementId, canExtend = false }: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  canExtend?: boolean;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const detail = useCustomerPackageDetail(scope, customerId, open ? entitlementId : null);
  return <>
    <details className="grid gap-2 text-start" onToggle={(event) => {
      setOpen(event.currentTarget.open);
      if (!event.currentTarget.open) setDialogOpen(false);
    }}>
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
      {open && detail.data ? <PackageExtensionHistory extensions={detail.data.extensions} /> : null}
      {canExtend && open && detail.data ? <Button type="button" onClick={() => setDialogOpen(true)}>
        {t(locale, 'packageExtension.extend')}
      </Button> : null}
    </details>
    {dialogOpen && detail.data ? <ExtendPackageDialog
      scope={scope}
      customerId={customerId}
      entitlementId={entitlementId}
      currentExpiresOn={detail.data.expires_on}
      onSaved={() => { void detail.refetch(); }}
      onClose={() => setDialogOpen(false)}
    /> : null}
  </>;
}
