'use client';
import type { ServiceCategoryBranchView } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchServiceCategories } from '../api/use-branch-service-categories';
import { BranchServiceCategoriesTable } from '../ui/branch-service-categories-table';
import { BranchServiceCategoryViewTabs } from '../ui/branch-service-category-view-tabs';

export function BranchServiceCategoriesSection({
  companyId,
  businessId,
  userId,
  branchId,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
}) {
  const locale = useLocale();
  const [view, setView] = useState<ServiceCategoryBranchView>('in_use');
  const [cursor, setCursor] = useState<string>();
  const list = useBranchServiceCategories(companyId, businessId, userId, branchId, {
    view,
    cursor,
  });
  return (
    <section className="flex min-w-0 flex-col gap-4 text-start">
      <p>
        {t(
          locale,
          view === 'in_use'
            ? 'catalogServiceCategoryBranches.leadInUse'
            : 'catalogServiceCategoryBranches.leadAvailable',
        )}
      </p>
      <BranchServiceCategoryViewTabs
        value={view}
        onChange={(next) => {
          setView(next);
          setCursor(undefined);
        }}
      />
      <BranchServiceCategoriesTable
        list={list}
        branchId={branchId}
        cursor={cursor}
        onPage={setCursor}
      />
    </section>
  );
}
