'use client';
import type { ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { serviceCategoryLabel } from '../model/service-category-label';
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
      <td>
        <div className="flex flex-wrap items-center gap-2">
          <span>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</span>
          {item.closed_at ? (
            <Badge variant="neutral">{t(locale, 'catalogServiceCategories.closed')}</Badge>
          ) : null}
        </div>
      </td>
      <td data-cell-label={t(locale, 'catalogServices.price')}>
        <span dir="ltr">{item.price}</span>
      </td>
      <td data-cell-label={t(locale, 'catalogServices.durationColumn')}>
        {item.duration_minutes === null ? (
          t(locale, 'catalogServices.missingValue')
        ) : (
          <>
            <span dir="ltr">{item.duration_minutes}</span>{' '}
            {t(locale, 'catalogServices.minutesShort')}
          </>
        )}
      </td>
      <td data-cell-label={t(locale, 'catalogServices.categoryColumn')}>
        {item.category
          ? serviceCategoryLabel(item.category, locale)
          : t(locale, 'catalogServices.missingValue')}
      </td>
      <td data-cell-label={t(locale, 'catalogServices.rule')}>
        {t(locale, SERVICE_RULE_LABEL[item.commission_rule.kind])}
      </td>
      <td data-cell-label={t(locale, 'catalogServices.edit')}>
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
