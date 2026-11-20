'use client';
import type { ServiceCategoryBranchListItem } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { branchCategoryMarks } from '../model/service-category-branch';

const VISIBILITY_LABEL: Record<ServiceCategoryBranchListItem['visibility'], MessageKey> = {
  BUSINESS: 'catalogServiceCategories.visibilityBusiness',
  BRANCH: 'catalogServiceCategories.visibilityBranch',
};

export function BranchServiceCategoryRow({
  item,
  branchId,
}: {
  item: ServiceCategoryBranchListItem;
  branchId: string;
}) {
  const locale = useLocale();
  const marks = branchCategoryMarks(item, branchId);
  return (
    <tr>
      <td>{locale === 'ar' ? item.name_ar : item.name_en}</td>
      <td>
        <Badge variant="neutral">{t(locale, VISIBILITY_LABEL[item.visibility])}</Badge>
      </td>
      <td>
        <div className="flex flex-wrap gap-2">
          {marks.ownedHere ? (
            <Badge variant="neutral">{t(locale, 'catalogServiceCategoryBranches.ownedHere')}</Badge>
          ) : null}
          {marks.hiddenHere ? (
            <Badge variant="neutral">
              {t(locale, 'catalogServiceCategoryBranches.hiddenHere')}
            </Badge>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
