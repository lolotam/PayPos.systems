'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeSellingToggle } from './package-type-selling-toggle';

/**
 * خلية «البيع»: التسمية تظهر فوق الزر في الصف المكدّس فقط حين يوجد زر؛
 * ومن غيره تبقى الخلية فارغة فتُخفى تحت 600px بدل أن تترك تسمية وحدها.
 */
export function PackageTypeSellingCell({
  item,
  shown,
  companyId,
  businessId,
  userId,
}: {
  item: PackageTypeListItem;
  shown: boolean;
  companyId: string;
  businessId: string;
  userId: string;
}) {
  const locale = useLocale();
  return (
    <td
      role="cell"
      data-cell-label={shown ? t(locale, 'catalogPackageTypes.selling') : undefined}
      className="max-[599.99px]:empty:hidden"
    >
      <PackageTypeSellingToggle
        item={item}
        canManage={shown}
        companyId={companyId}
        businessId={businessId}
        userId={userId}
      />
    </td>
  );
}
