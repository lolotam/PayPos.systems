'use client';
import type { ServiceCategory, ServiceCategoryBranchListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchServiceCategoryShare } from '../api/use-branch-service-category-save';
import { ServiceCategoryFormFeedback } from './service-category-form-feedback';

type BranchServiceCategoryShareProps = {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
  record: ServiceCategoryBranchListItem;
  onShared: (category: ServiceCategory) => void;
  onReload: () => void;
};

/**
 * زرار «خليه مشترك لكل الفروع» بتأكيده. المشاركة قرار في اتجاه واحد (SI-Q23)
 * فبتاخد سطر تحذير قبل التنفيذ، وبتبعت أسماء التصنيف زي ما هي — بتغيّر الظهور بس.
 */
export function BranchServiceCategoryShare({
  companyId,
  businessId,
  userId,
  branchId,
  record,
  onShared,
  onReload,
}: BranchServiceCategoryShareProps) {
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const share = useBranchServiceCategoryShare(companyId, businessId, userId, branchId);
  const shareInput = {
    categoryId: record.id,
    name_en: record.name_en,
    name_ar: record.name_ar,
    expected_revision: record.revision,
  };
  const shareNow = () => share.mutate(shareInput, { onSuccess: onShared });
  return (
    <div className="flex flex-col gap-3">
      {confirming ? (
        <>
          <p>{t(locale, 'catalogServiceCategoryBranches.shareConfirm')}</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={share.isPending} onClick={shareNow}>
              {t(locale, 'catalogServiceCategories.confirm')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>
              {t(locale, 'catalogServiceCategories.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={share.isPending}
          onClick={() => setConfirming(true)}
        >
          {t(locale, 'catalogServiceCategoryBranches.share')}
        </Button>
      )}
      <ServiceCategoryFormFeedback
        mode="share"
        error={share.error}
        success={false}
        onReload={onReload}
      />
    </div>
  );
}
