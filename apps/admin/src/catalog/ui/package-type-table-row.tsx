'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useIsMutating } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeName } from './package-type-name';
import { PackageTypeSellingCell } from './package-type-selling-cell';

export function PackageTypeTableRow({
  item,
  canManage,
  companyId,
  businessId,
  userId,
  selected,
  onSelect,
}: {
  item: PackageTypeListItem;
  canManage: boolean;
  companyId: string;
  businessId: string;
  userId: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  const selling = useIsMutating({
    mutationKey: ['package-type-selling', companyId, businessId, userId],
  });
  return (
    // الأدوار صريحة: بعد أن تصبح الصفوف بلوك تحت 600px يبقى قارئ الشاشة يقرأها
    // صفوف جدول ويربط كل خلية بترويسة عمودها بالترتيب نفسه.
    <tr role="row" className={selected ? 'bg-secondary/50' : ''}>
      <td role="cell">
        <PackageTypeName item={item} />
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.price')}>
        <bdi dir="ltr">{item.price}</bdi>
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.validity')}>
        {item.validity_days}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.componentCount')}>
        {item.component_count}
      </td>
      <PackageTypeSellingCell
        item={item}
        shown={canManage && !selected}
        companyId={companyId}
        businessId={businessId}
        userId={userId}
      />
      <td role="cell">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          disabled={selling > 0}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'catalogPackageTypes.edit')}
        </Button>
      </td>
    </tr>
  );
}
