'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { CustomerPackageDetail } from '@pospay/contracts';
import { PackageExtensionHistory } from './package-extension-history';
import { PackageRedemptionList } from './package-redemption-list';

/**
 * جسم سجل الباقة داخل النموذج (43-3): الصفوف نفسها بتاعة التفصيل المستقل من PackageRedemptionList،
 * والتمديدات وزر التمديد بيتتبعوا can_extend من الخادم (BR-A2).
 */
export function PackageRedemptionHistoryBody({
  detail,
  onExtend,
}: {
  detail: CustomerPackageDetail;
  onExtend: () => void;
}) {
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
      {detail.can_extend ? (
        <Button type="button" onClick={onExtend}>
          {t(locale, 'packageExtension.extend')}
        </Button>
      ) : null}
    </>
  );
}
