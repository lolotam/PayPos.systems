'use client';
import type { ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { SERVICE_RULE_LABEL } from '../model/service-rule';

export function ServiceTableRow({
  item,
  selected,
  onSelect,
}: {
  item: ServiceListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</td>
      <td dir="ltr">{item.price}</td>
      <td>{t(locale, SERVICE_RULE_LABEL[item.commission_rule.kind])}</td>
      <td>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'catalogServices.edit')}
        </Button>
      </td>
    </tr>
  );
}
