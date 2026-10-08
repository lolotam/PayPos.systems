'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function PackageTypeTableRow({
  item,
  selected,
  onSelect,
}: {
  item: PackageTypeListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</td>
      <td dir="ltr">{item.price}</td>
      <td>{item.validity_days}</td>
      <td>{item.component_count}</td>
      <td>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'catalogPackageTypes.edit')}
        </Button>
      </td>
    </tr>
  );
}
