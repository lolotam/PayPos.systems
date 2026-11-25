'use client';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageExtensionControls } from './customer-package-extension-controls';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { PackageRedemptionHistoryBody } from './package-redemption-history-body';

export function PackageRedemptionHistory({
  scope,
  customerId,
  entitlementId,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const detail = useCustomerPackageDetail(scope, customerId, open ? entitlementId : null, true);
  const proof = readAccessProof(detail);
  const data = open && proof === 'granted' ? detail.data : undefined;
  return (
    <details
      className="grid gap-2 text-start"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t(locale, 'serviceSessions.packageHistory')}</summary>
      {open && proof === 'pending' ? (
        <p role="status">{t(locale, 'serviceSessions.packageLoading')}</p>
      ) : null}
      {open && (proof === 'failed' || detail.isError) ? (
        <p role="alert">{t(locale, 'serviceSessions.packageHistoryLoadFailed')}</p>
      ) : null}
      {data ? <PackageRedemptionHistoryBody detail={data} /> : null}
      {data?.can_extend ? (
        <CustomerPackageExtensionControls
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          expiresOn={data.expires_on}
          onSaved={() => void detail.refetch()}
          buttonLabel={t(locale, 'packageExtension.extend')}
        />
      ) : null}
    </details>
  );
}
