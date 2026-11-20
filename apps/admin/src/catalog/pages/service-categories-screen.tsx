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

/** الفروع النشطة بس هي اللي بتظهر في القايمة وبتاخد فرع البداية، فالفرع الموقوف ما يرجعله حد بالغلط. */
function activeBranchesOf(business: WorkspaceBusiness) {
  return business.branches.filter((branch) => branch.is_active);
}

/**
 * عضوية الفرع مش بتغطي صلاحيات `:business`، ففتح «كل النشاط» معاها يبقى 403 مضمون
 * على كل استعلام — علشان كده الفرع بيفتح على فرعه بدل قائمة النشاط.
 *
 * @param scope              أوسع عضوية ليها اليوزر في الشركة
 * @param business           النشاط المختار بفروعه
 * @param rememberedBranchId الفرع المتذكر من مساحة العمل، لو موجود
 * @returns فرع البداية من الفروع النشطة: المتذكر، وإلا أول فرع نشط، و«كل النشاط» لما النطاق أوسع من فرع
 */
function openingBranch(
  scope: WorkspaceCompany['scope'],
  business: WorkspaceBusiness,
  rememberedBranchId: string | undefined,
): string | null {
  if (scope !== 'BRANCH') return null;
  const active = activeBranchesOf(business);
  const remembered = active.find((branch) => branch.id === rememberedBranchId);
  return remembered?.id ?? active[0]?.id ?? null;
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
  // عضوية الفرع أوسع من فرع واحد بس، فمفيش طريقة تعرف منها إذن الوصول لمستوى النشاط
  // على نشاط مختار — القرار ده مؤجل لقرار المالك (issue #1133) والسلوك الحالي بيفضل زي ما هو.
  const businessReach = scope !== 'BRANCH';
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <ServiceCategoryScopeSelect
        branches={activeBranchesOf(business)}
        includeBusiness={businessReach}
        value={branchId}
        onChange={setBranchId}
      />
      {businessReach || branchId === null ? (
        // الصفحة بتفضل محمولة مخفية وقت الفرع، عشان مهام القفل المعلقة (202) وأثرها ما يضيعش لما المستخدم يرجع.
        <div hidden={branchId !== null}>
          <ServiceCategoriesPage
            key={`${companyId}:${business.id}:${userId}`}
            companyId={companyId}
            business={business}
            userId={userId}
          />
        </div>
      ) : null}
      {branchId !== null ? (
        <BranchServiceCategoriesSection
          key={branchId}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          branchId={branchId}
        />
      ) : null}
    </section>
  );
}
