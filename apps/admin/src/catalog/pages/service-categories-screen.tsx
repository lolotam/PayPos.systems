'use client';
import type {
  WorkspaceBranch,
  WorkspaceBusinessRead,
  WorkspaceCompanyRead,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { EmptyState, PageShell, Store } from '@pospay/ui';
import { useState } from 'react';
import { useScreenCreateAction } from '../model/use-screen-create-action';
import { BranchServiceCategoriesSection } from './branch-service-categories-section';
import { ServiceCategoriesPage } from './service-categories-page';
import { ServiceCategoriesHeader } from '../ui/service-categories-header';
import { ServiceCategoryScopeSelect } from '../ui/service-category-scope-select';
import { useLocale } from '@/shared/locale/locale-context';
import { businessScope } from '@/workspace/model/business-scope';

type ServiceCategoriesScreenProps = {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
  /** أوسع عضوية اليوزر في الشركة؛ أوسع وصوله على النشاط المختار هو نطاق النشاط نفسه. */
  companyScope: WorkspaceCompanyRead['scope'];
  rememberedBranchId: string | undefined;
};

/** الفروع النشطة بس هي اللي بتظهر في القايمة وبتاخد فرع البداية، فالفرع الموقوف ما يرجعله حد بالغلط. */
function activeBranchesOf(business: WorkspaceBusinessRead): readonly WorkspaceBranch[] {
  return business.branches.filter((branch) => branch.is_active);
}

/**
 * عضوية الفرع مش بتغطي صلاحيات `:business`، ففتح «كل النشاط» معاها يبقى 403 مضمون
 * على كل استعلام — علشان كده الفرع بيفتح على فرعه بدل قائمة النشاط.
 *
 * @param scope              أوسع وصول اليوزر على النشاط المختار
 * @param activeBranches     الفروع النشطة للنشاط المختار بفروعه
 * @param rememberedBranchId الفرع المتذكر من مساحة العمل، لو موجود
 * @returns فرع البداية من الفروع النشطة: المتذكر، وإلا أول فرع نشط، و«كل النشاط» لما النطاق أوسع من فرع
 */
function openingBranch(
  scope: WorkspaceCompanyRead['scope'],
  activeBranches: readonly WorkspaceBranch[],
  rememberedBranchId: string | undefined,
): string | null {
  if (scope !== 'BRANCH') return null;
  const remembered = activeBranches.find((branch) => branch.id === rememberedBranchId);
  return remembered?.id ?? activeBranches[0]?.id ?? null;
}

// أوسع وصول اليوزر على النشاط المختار بييجي مع مساحة العمل، فالعضوية على الشركة لوحدها
// مش بتكفي: نشاط وصله اليوزر عن طريق فرع بس بيفتح على الفرع، مش على «كل النشاط».
export function ServiceCategoriesScreen({
  companyId,
  business,
  userId,
  companyScope,
  rememberedBranchId,
}: ServiceCategoriesScreenProps) {
  const locale = useLocale();
  const activeBranches = activeBranchesOf(business);
  const scope = businessScope(business, companyScope);
  const [branchId, setBranchId] = useState<string | null>(() =>
    openingBranch(scope, activeBranches, rememberedBranchId),
  );
  const businessReach = scope !== 'BRANCH';
  const branchScopeEmpty = scope === 'BRANCH' && activeBranches.length === 0;
  const businessView = branchId === null;
  const { setHandler, action } = useScreenCreateAction({ companyId, businessId: business.id, userId }, branchId);
  return (
    <PageShell layout="list">
      <ServiceCategoriesHeader businessView={businessView} showLead={businessView && !branchScopeEmpty} action={branchScopeEmpty ? null : action} />
      <ServiceCategoryScopeSelect
        branches={activeBranches}
        includeBusiness={businessReach}
        value={branchId}
        onChange={setBranchId}
      />
      {branchScopeEmpty ? (
        // فرع-سكوب من غير فرع نشط: قائمة النشاط هترجع 403 له، فبيعرض حالة فاضية واضحة بدلها.
        <EmptyState
          icon={<Store />}
          title={t(locale, 'catalogServiceCategoryBranches.noActiveBranch')}
        />
      ) : (
        <>
          {businessReach || branchId === null ? (
            // الصفحة بتفضل محمولة مخفية وقت الفرع، عشان مهام القفل المعلقة (202) وأثرها ما يضيعش لما المستخدم يرجع.
            <div hidden={branchId !== null}>
              <ServiceCategoriesPage
                key={`${companyId}:${business.id}:${userId}`}
                companyId={companyId}
                business={business}
                userId={userId}
                embed={{ setHandler, active: businessView }}
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
              embed={{ setHandler, active: true }}
            />
          ) : null}
        </>
      )}
    </PageShell>
  );
}
