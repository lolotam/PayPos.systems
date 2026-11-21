'use client';
import type { ServiceCategory, ServiceCategoryBranchListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { BranchServiceCategoryForm } from './branch-service-category-form';
import { BranchServiceCategoryShare } from './branch-service-category-share';

/** لوحة تصنيف الفرع الخاص: إعادة التسمية وجعله مشترك وزرار إغلاقها. أي نتيجة ناجحة بتقفل اللوحة. */
export function BranchServiceCategoryPanel({
  companyId,
  businessId,
  userId,
  branchId,
  record,
  onShared,
  onReload,
  onClose,
  onSeeAvailable,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
  record: ServiceCategoryBranchListItem;
  onShared: (category: ServiceCategory) => void;
  onReload: () => void;
  onClose: () => void;
  onSeeAvailable: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <BranchServiceCategoryForm
        mode="rename"
        companyId={companyId}
        businessId={businessId}
        userId={userId}
        branchId={branchId}
        record={record}
        onRenamed={onClose}
        onSeeAvailable={onSeeAvailable}
        onReload={onReload}
      />
      <BranchServiceCategoryShare
        companyId={companyId}
        businessId={businessId}
        userId={userId}
        branchId={branchId}
        record={record}
        onShared={onShared}
        onReload={onReload}
      />
      <div>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          {t(locale, 'catalogServiceCategories.cancel')}
        </Button>
      </div>
    </div>
  );
}
