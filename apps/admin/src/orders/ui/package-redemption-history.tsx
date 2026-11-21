'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';
import { ExtendPackageDialog } from './extend-package-dialog';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';

export function PackageRedemptionHistory({ scope, customerId, entitlementId }: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
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
      {open && detail.data ? <HistoryBody detail={detail.data} onExtend={() => setDialogOpen(true)} /> : null}
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

// الصفوف نفسها في PackageRedemptionList بتاعة التفصيل المستقل، عشان النموذج والتفصيل يعرضوا نفس القايمة (D-A3).
function HistoryBody({ detail, onExtend }: {
  detail: NonNullable<ReturnType<typeof useCustomerPackageDetail>['data']>;
  onExtend: () => void;
}) {
  const locale = useLocale();
  return <>
    {detail.redemptions.length === 0 ? <p role="status">{t(locale, 'serviceSessions.packageHistoryEmpty')}</p> : null}
    {detail.redemptions.length > 0 ? <PackageRedemptionList redemptions={detail.redemptions} components={detail.components} /> : null}
    <PackageExtensionHistory extensions={detail.extensions} timeZone={detail.business_timezone} />
    {detail.can_extend ? <Button type="button" onClick={onExtend}>
      {t(locale, 'packageExtension.extend')}
    </Button> : null}
  </>;
}
