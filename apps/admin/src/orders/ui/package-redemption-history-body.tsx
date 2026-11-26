'use client';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { CustomerPackageDetail } from '@pospay/contracts';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';
import { PackageRefundHistory } from './package-refund-history';

/**
 * جسم سجل الباقة داخل النموذج (43-3): الصفوف نفسها بتاعة التفصيل المستقل من PackageRedemptionList،
 * ويعرض التمديدات والاستردادات المسجلة للباقة بعد نجاح القراءة المحمية.
 */
export function PackageRedemptionHistoryBody({ detail }: { detail: CustomerPackageDetail }) {
  const locale = useLocale();
  return (
    <>
      {detail.redemptions.length === 0 ? (
        <p role="status">{t(locale, 'serviceSessions.packageHistoryEmpty')}</p>
      ) : null}
      {detail.redemptions.length > 0 ? (
        <PackageRedemptionList redemptions={detail.redemptions} components={detail.components} />
      ) : null}
      <PackageExtensionHistory extensions={detail.extensions} timeZone={detail.business_timezone} />
      <PackageRefundHistory refunds={detail.refunds} timeZone={detail.business_timezone} />
    </>
  );
}
