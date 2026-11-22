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
    // الأدوار صريحة: بعد أن تصبح الصفوف بلوك تحت 600px يبقى قارئ الشاشة يقرأها
    // صفوف جدول ويربط كل خلية بترويسة عمودها بالترتيب نفسه.
    <tr role="row" className={selected ? 'bg-secondary/50' : ''}>
      <td role="cell">
        {/* min-w-0 على الاسم يسمح للاسم الطويل بلا فواصل أن يتقلص ويلتف داخل
            البطاقة المكدسة بدل أن يفرض تمريرًا جانبيًا. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0">
            {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
          </span>
          {item.closed_at ? (
            <Badge variant="neutral">{t(locale, 'catalogServiceCategories.closed')}</Badge>
          ) : null}
        </div>
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogServices.price')}>
        <span dir="ltr">{item.price}</span>
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogServices.durationColumn')}>
        {item.duration_minutes === null ? (
          t(locale, 'catalogServices.missingValue')
        ) : (
          <>
            <span dir="ltr">{item.duration_minutes}</span>{' '}
            {t(locale, 'catalogServices.minutesShort')}
          </>
        )}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogServices.categoryColumn')}>
        {item.category
          ? serviceCategoryLabel(item.category, locale)
          : t(locale, 'catalogServices.missingValue')}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogServices.rule')}>
        {t(locale, SERVICE_RULE_LABEL[item.commission_rule.kind])}
      </td>
      <td role="cell" data-cell-label={t(locale, 'catalogServices.edit')}>
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
