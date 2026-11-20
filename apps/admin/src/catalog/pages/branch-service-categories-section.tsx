'use client';
import type {
  ServiceCategory,
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useBranchServiceCategories } from '../api/use-branch-service-categories';
import { useBranchServiceCategoryState } from '../api/use-branch-service-category-state';
import { BranchServiceCategoriesTable } from '../ui/branch-service-categories-table';
import { BranchServiceCategoryForm } from '../ui/branch-service-category-form';
import {
  BranchServiceCategoryOutcome,
  type BranchCategoryOutcome,
} from '../ui/branch-service-category-outcome';
import { BranchServiceCategoryPanel } from '../ui/branch-service-category-panel';
import { BranchServiceCategoryViewTabs } from '../ui/branch-service-category-view-tabs';

type BranchSectionScope = {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
};

const rowName = (item: ServiceCategoryBranchListItem, locale: Locale) =>
  locale === 'ar' ? item.name_ar : item.name_en;

const categoryName = (category: ServiceCategory, locale: Locale) =>
  locale === 'ar' ? category.name_ar : category.name_en;

/** حالة القسم: التاب والمؤشر والنموذج المفتوح والصف المختار ونتيجة آخر كتابة، مع حركات التنقل بينها. */
function useSectionState() {
  const locale = useLocale();
  const [view, setView] = useState<ServiceCategoryBranchView>('in_use');
  const [cursor, setCursor] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [outcome, setOutcome] = useState<BranchCategoryOutcome | null>(null);
  const switchView = (next: ServiceCategoryBranchView) => {
    setView(next);
    setCursor(undefined);
    setCreating(false);
    setSelectedId('');
  };
  const openCreate = () => {
    setCreating(true);
    setSelectedId('');
    setOutcome(null);
  };
  const manageRow = (categoryId: string) => {
    setSelectedId(categoryId);
    setCreating(false);
  };
  const lead =
    view === 'in_use'
      ? t(locale, 'catalogServiceCategoryBranches.leadInUse')
      : t(locale, 'catalogServiceCategoryBranches.leadAvailable');
  return {
    view,
    cursor,
    creating,
    selectedId,
    outcome,
    lead,
    createLabel: t(locale, 'catalogServiceCategories.create'),
    setCursor,
    setSelectedId,
    setOutcome,
    switchView,
    openCreate,
    manageRow,
  };
}

type SectionState = ReturnType<typeof useSectionState>;

/** النتايج بتحتفظ في القسم مش في البند: البند بيسيب التاب بعد النجاح أو الرفض، فالسطر الثابت هو اللي يوضّح انتهى إيه. */
function useSectionOutcomes(
  scope: BranchSectionScope,
  list: ReturnType<typeof useBranchServiceCategories>,
  section: SectionState,
) {
  const locale = useLocale();
  const stateWrite = useBranchServiceCategoryState(
    scope.companyId,
    scope.businessId,
    scope.userId,
    scope.branchId,
  );
  const writeState = (
    item: ServiceCategoryBranchListItem,
    next: ServiceCategoryBranchSettingState,
  ) => {
    stateWrite.mutate(
      { categoryId: item.id, state: next, expectedRevision: item.setting_revision },
      {
        onSuccess: () =>
          section.setOutcome({
            categoryId: item.id,
            name: rowName(item, locale),
            kind: next === 'HIDDEN' ? 'hidden' : 'enabled',
          }),
        onError: (error) =>
          section.setOutcome({
            categoryId: item.id,
            name: rowName(item, locale),
            kind: 'refused',
            error,
          }),
      },
    );
  };
  const onCreated = (category: ServiceCategory) => {
    section.setOutcome({
      categoryId: category.id,
      name: categoryName(category, locale),
      kind: 'created',
    });
    section.switchView('in_use');
  };
  const onShared = (category: ServiceCategory) => {
    section.setOutcome({
      categoryId: category.id,
      name: categoryName(category, locale),
      kind: 'shared',
    });
    section.setSelectedId('');
  };
  return {
    writeState,
    onCreated,
    onShared,
    reload: () => void list.refetch(),
    pending: stateWrite.isPending,
    selected: list.data?.items.find((item) => item.id === section.selectedId) ?? null,
  };
}

export function BranchServiceCategoriesSection(scope: BranchSectionScope) {
  const section = useSectionState();
  const list = useBranchServiceCategories(
    scope.companyId,
    scope.businessId,
    scope.userId,
    scope.branchId,
    { view: section.view, cursor: section.cursor },
  );
  const outcomes = useSectionOutcomes(scope, list, section);
  return (
    <section className="flex min-w-0 flex-col gap-4 text-start">
      <p>{section.lead}</p>
      <div className="flex flex-wrap items-center gap-2">
        <BranchServiceCategoryViewTabs value={section.view} onChange={section.switchView} />
        <Button variant="outline" size="sm" onClick={section.openCreate}>
          {section.createLabel}
        </Button>
      </div>
      <BranchServiceCategoryOutcome outcome={section.outcome} />
      {section.creating ? (
        <BranchServiceCategoryForm
          mode="create"
          {...scope}
          onCreated={outcomes.onCreated}
          onReload={outcomes.reload}
          onSeeAvailable={() => section.switchView('available')}
        />
      ) : null}
      {outcomes.selected ? (
        <BranchServiceCategoryPanel
          key={`${outcomes.selected.id}:${outcomes.selected.revision}`}
          {...scope}
          record={outcomes.selected}
          onShared={outcomes.onShared}
          onReload={outcomes.reload}
          onClose={() => section.setSelectedId('')}
        />
      ) : null}
      <BranchServiceCategoriesTable
        list={list}
        branchId={scope.branchId}
        view={section.view}
        pending={outcomes.pending}
        cursor={section.cursor}
        onPage={section.setCursor}
        onState={outcomes.writeState}
        onManage={section.manageRow}
      />
    </section>
  );
}
