'use client';
import type { ServiceCategoryClosingAction, ServiceCategoryListItem } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

const VISIBILITY_LABEL: Record<ServiceCategoryListItem['visibility'], MessageKey> = {
  BUSINESS: 'catalogServiceCategories.visibilityBusiness',
  BRANCH: 'catalogServiceCategories.visibilityBranch',
};

export function ServiceCategoryRow({
  item,
  selected,
  pendingAction,
  onSelect,
}: {
  item: ServiceCategoryListItem;
  selected: boolean;
  pendingAction: ServiceCategoryClosingAction | null;
  onSelect: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <tr className={selected ? 'bg-secondary/50' : ''}>
      <td>{locale === 'ar' ? item.name_ar : item.name_en}</td>
      <td>
        <Badge variant="neutral">{t(locale, VISIBILITY_LABEL[item.visibility])}</Badge>
      </td>
      <td>
        <div className="flex flex-wrap gap-2">
          <Badge variant={item.closed_at === null ? 'success' : 'neutral'}>
            {t(
              locale,
              item.closed_at === null
                ? 'catalogServiceCategories.open'
                : 'catalogServiceCategories.closed',
            )}
          </Badge>
          {pendingAction ? (
            <Badge variant="warning">
              {t(
                locale,
                pendingAction === 'close'
                  ? 'catalogServiceCategories.closing'
                  : 'catalogServiceCategories.reopening',
              )}
            </Badge>
          ) : null}
        </div>
      </td>
      <td>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={selected}
          onClick={() => onSelect(item.id)}
        >
          {t(locale, 'catalogServiceCategories.manage')}
        </Button>
      </td>
    </tr>
  );
}
