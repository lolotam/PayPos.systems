import type { CommissionOverrideServiceItem } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t, type Locale } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { overrideRuleText } from '../model/override-rule-text';
import { civilDate } from './plan-history-columns';

/** اسم الخدمة بالعربي وقت ما اللغة عربي والاسم موجود، وإلا بالإنجليزي. */
export function overrideServiceName(item: CommissionOverrideServiceItem, locale: Locale): string {
  return locale === 'ar' && item.name_ar !== null ? item.name_ar : item.name_en;
}

/** أعمدة جدول خدمات الشاشة: الاسم والسعر وقاعدة الخدمة وقاعدة التجاوز الحالية وزر التعديل. */
export function overrideServicesColumns(
  locale: Locale,
  onEdit: (item: CommissionOverrideServiceItem) => void,
): ColumnDef<CommissionOverrideServiceItem>[] {
  return [
    {
      id: 'service',
      header: t(locale, 'commissionOverrides.colService'),
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span>{overrideServiceName(row.original, locale)}</span>
          {row.original.closed_at !== null ? (
            <Badge variant="neutral">{t(locale, 'commissionOverrides.closedBadge')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'price',
      header: t(locale, 'catalogServices.price'),
      cell: ({ row }) => <span dir="ltr">{formatKwd(parseMoney(row.original.price))}</span>,
    },
    {
      id: 'serviceRule',
      header: t(locale, 'commissionOverrides.colServiceRule'),
      cell: ({ row }) => overrideRuleText(row.original.service_rule, locale),
    },
    {
      id: 'override',
      header: t(locale, 'commissionOverrides.colOverride'),
      cell: ({ row }) => {
        const current = row.original.current_override;
        if (current === null) return t(locale, 'commissionOverrides.noOverride');
        return (
          <span className="flex flex-col">
            <span>{overrideRuleText(current.rule, locale)}</span>
            <span>{t(locale, 'commissionOverrides.colEffectiveFrom')}:{' '}{civilDate(current.effective_from, locale)}</span>
          </span>
        );
      },
    },
    {
      id: 'edit',
      header: () => null,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t(locale, 'commissionOverrides.edit')}
          onClick={() => onEdit(row.original)}
        >
          {t(locale, 'commissionOverrides.edit')}
        </Button>
      ),
    },
  ];
}
