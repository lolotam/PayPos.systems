'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useIsMutating } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeSellingToggle } from './package-type-selling-toggle';

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
        {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
        {item.selling_stopped_at !== null ? (
          <span className="ms-2 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
            {t(locale, 'catalogPackageTypes.notOnSale')}
          </span>
        ) : null}
      </td>
      <td role="cell" dir="ltr" data-cell-label={t(locale, 'catalogPackageTypes.price')}>
        {item.price}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.validity')}>
        {item.validity_days}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.componentCount')}>
        {item.component_count}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.selling')}>
        <PackageTypeSellingToggle
          item={item}
          canManage={canManage && !selected}
          companyId={companyId}
          businessId={businessId}
          userId={userId}
        />
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogPackageTypes.edit')}>
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
