'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { CustomerPackageDetail } from './customer-package-detail';

/**
 * منطقة الاختيار تحت القايمة: تفصيل الباقة المفتوحة، أو رسالة «غير موجودة» لقيمة ?package= فاسخ
 * من غير أي طلب (CP-02) مع زر إغلاق بيمسح الاختيار من العنوان.
 */
export function PackagesSelectionArea({
  scope,
  customerId,
  entitlementId,
  hasRawSelection,
  onClose,
}: {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string | null;
  hasRawSelection: boolean;
  onClose: () => void;
}) {
  const locale = useLocale();
  if (entitlementId !== null) {
    return (
      <CustomerPackageDetail
        key={entitlementId}
        scope={scope}
        customerId={customerId}
        entitlementId={entitlementId}
        onClose={onClose}
      />
    );
  }
  if (hasRawSelection) {
    // قيمة ?package= فاسخ: تفصيل «غير موجود» من غير أي طلب تفصيل، وزر إغلاق بيمسح الاختيار من العنوان.
    return (
      <p role="alert">
        {t(locale, 'customerPackages.detailNotFound')}{' '}
        <Button type="button" variant="outline" onClick={onClose}>
          {t(locale, 'customerPackages.close')}
        </Button>
      </p>
    );
  }
  return null;
}
