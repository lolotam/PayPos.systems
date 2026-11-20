'use client';
import type {
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Badge, Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { branchCategoryActions, branchCategoryMarks } from '../model/service-category-branch';
import { BranchServiceCategoryStateButton } from './branch-service-category-state-button';

const VISIBILITY_LABEL: Record<ServiceCategoryBranchListItem['visibility'], MessageKey> = {
  BUSINESS: 'catalogServiceCategories.visibilityBusiness',
  BRANCH: 'catalogServiceCategories.visibilityBranch',
};

export function BranchServiceCategoryRow({
  item,
  branchId,
  view,
  pending,
  onState,
  onManage,
}: {
  item: ServiceCategoryBranchListItem;
  branchId: string;
  view: ServiceCategoryBranchView;
  pending: boolean;
  onState: (item: ServiceCategoryBranchListItem, state: ServiceCategoryBranchSettingState) => void;
  onManage: (categoryId: string) => void;
}) {
  const locale = useLocale();
  const marks = branchCategoryMarks(item, branchId);
  const actions = branchCategoryActions(item, branchId, view);
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
      <td>
        <div className="flex flex-wrap gap-2">
          <BranchServiceCategoryStateButton
            view={view}
            pending={pending}
            onState={(state) => onState(item, state)}
          />
          {actions.rename ? (
            <Button variant="outline" size="sm" onClick={() => onManage(item.id)}>
              {t(locale, 'catalogServiceCategories.manage')}
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
