'use client';

import type { customerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { HeldAttempt } from '../api/use-refund-package';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageComponents } from './customer-package-components';
import { CustomerPackageExtensionControls } from './customer-package-extension-controls';
import { CustomerPackageRefundControls } from './customer-package-refund-controls';
import { DetailHeader } from './detail-header';
import { DetailSaleFacts } from './detail-sale-facts';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';
import { PackageRefundHistory } from './package-refund-history';

/** جسم التفصيل بعد الإثبات: الحقول والمكوّنات والسجلات وحوار التمديد والاسترداد على can_extend وcan_refund الحيّين. */
export function CustomerPackageDetailContent({
  scope,
  customerId,
  entitlementId,
  data,
  heldRefundAttemptRef,
  onSaved,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  data: ReturnType<typeof customerPackageDetail.parse>;
  heldRefundAttemptRef?: { current: HeldAttempt | null } | undefined;
  onSaved: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <section
      className="grid gap-3 rounded-card border border-border p-3 text-start"
      aria-label={t(locale, 'customerPackages.title')}
    >
      <DetailHeader data={data} onClose={onClose} />
      <DetailSaleFacts data={data} />
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.components')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.components')}</h3>
        <CustomerPackageComponents components={data.components} />
      </section>
      <section className="grid gap-2" aria-label={t(locale, 'customerPackages.redemptions')}>
        <h3 className="font-semibold">{t(locale, 'customerPackages.redemptions')}</h3>
        <PackageRedemptionList redemptions={data.redemptions} components={data.components} />
      </section>
      <PackageExtensionHistory extensions={data.extensions} timeZone={data.business_timezone} />
      <PackageRefundHistory refunds={data.refunds} timeZone={data.business_timezone} />
      {data.can_extend ? (
        <CustomerPackageExtensionControls
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          expiresOn={data.expires_on}
          onSaved={onSaved}
        />
      ) : null}
      {data.can_refund ? (
        <CustomerPackageRefundControls
          scope={scope}
          customerId={customerId}
          entitlementId={entitlementId}
          detail={data}
          heldAttemptRef={heldRefundAttemptRef}
          onSaved={onSaved}
        />
      ) : null}
    </section>
  );
}
