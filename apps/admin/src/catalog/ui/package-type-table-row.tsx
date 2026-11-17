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
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>
        {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
        {item.selling_stopped_at !== null ? (
          <span className="ms-2 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
            {t(locale, 'catalogPackageTypes.notOnSale')}
          </span>
        ) : null}
      </td>
      <td dir="ltr">{item.price}</td>
      <td>{item.validity_days}</td>
      <td>{item.component_count}</td>
      <td>
        <PackageTypeSellingToggle
          item={item}
          canManage={canManage && !selected}
          companyId={companyId}
          businessId={businessId}
          userId={userId}
        />
      </td>
      <td>
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
