'use client';
import type { WorkspaceBusiness, WorkspaceCompany } from '@pospay/contracts';
import { useState } from 'react';
import { BranchServiceCategoriesSection } from './branch-service-categories-section';
import { ServiceCategoriesPage } from './service-categories-page';
import { ServiceCategoryScopeSelect } from '../ui/service-category-scope-select';

type ServiceCategoriesScreenProps = {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
  scope: WorkspaceCompany['scope'];
  rememberedBranchId: string | undefined;
};

/**
 * عضوية الفرع مش بتغطي صلاحيات `:business`، ففتح «كل النشاط» معاها يبقى 403 مضمون
 * على كل استعلام — علشان كده الفرع بيفتح على فرعه بدل قائمة النشاط.
 *
 * @param scope              أوسع عضوية ليها اليوزر في الشركة
 * @param business           النشاط المختار بفروعة
 * @param rememberedBranchId الفرع المتذكر من مساحة العمل، لو موجود
 * @returns فرع البداية: المتذكر، وإلا أول فرع، و«كل النشاط» لما النطاق أوسع من فرع
 */
function openingBranch(
  scope: WorkspaceCompany['scope'],
  business: WorkspaceBusiness,
  rememberedBranchId: string | undefined,
): string | null {
  if (scope !== 'BRANCH') return null;
  const remembered = business.branches.find((branch) => branch.id === rememberedBranchId);
  return remembered?.id ?? business.branches[0]?.id ?? null;
}

export function ServiceCategoriesScreen({
  companyId,
  business,
  userId,
  scope,
  rememberedBranchId,
}: ServiceCategoriesScreenProps) {
  const [branchId, setBranchId] = useState<string | null>(() =>
    openingBranch(scope, business, rememberedBranchId),
  );
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <ServiceCategoryScopeSelect
        branches={business.branches}
        includeBusiness={scope !== 'BRANCH'}
        value={branchId}
        onChange={setBranchId}
      />
      {branchId === null ? (
        <ServiceCategoriesPage
          key={`${companyId}:${business.id}:${userId}`}
          companyId={companyId}
          business={business}
          userId={userId}
        />
      ) : (
        <BranchServiceCategoriesSection
          key={branchId}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          branchId={branchId}
        />
      )}
    </section>
  );
}
