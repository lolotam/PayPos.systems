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
import { useBranchServiceCategorySavePending } from '../api/use-branch-service-category-save';
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
  const [selected, setSelected] = useState<ServiceCategoryBranchListItem | null>(null);
  const [outcome, setOutcome] = useState<BranchCategoryOutcome | null>(null);
  const switchView = (next: ServiceCategoryBranchView) => {
    setView(next);
    setCursor(undefined);
    setCreating(false);
    setSelected(null);
  };
  const openCreate = () => {
    setCreating(true);
    setSelected(null);
    setOutcome(null);
  };
  const manageRow = (item: ServiceCategoryBranchListItem) => {
    setSelected(item);
    setCreating(false);
  };
  const changePage = (next: string | undefined) => {
    setCursor(next);
    setSelected(null);
  };
  const lead =
    view === 'in_use'
      ? t(locale, 'catalogServiceCategoryBranches.leadInUse')
      : t(locale, 'catalogServiceCategoryBranches.leadAvailable');
  return {
    view,
    cursor,
    creating,
    selected,
    outcome,
    lead,
    createLabel: t(locale, 'catalogServiceCategories.create'),
    changePage,
    setSelected,
    setOutcome,
    switchView,
    openCreate,
    manageRow,
  };
}

type SectionState = ReturnType<typeof useSectionState>;

async function reloadSelectedCategory(
  list: ReturnType<typeof useBranchServiceCategories>,
  section: SectionState,
) {
  const selected = section.selected;
  const result = await list.refetch();
  if (selected && result.isSuccess) {
    const refreshed =
      result.data.items.find(
        (item) =>
          item.id === selected.id &&
          item.visibility === 'BRANCH' &&
          item.owner_branch_id === selected.owner_branch_id,
      ) ?? null;
    section.setSelected((current) => (current === selected ? refreshed : current));
  }
}

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
    section.setSelected(null);
  };
  return {
    writeState,
    onCreated,
    onShared,
    reload: () => void reloadSelectedCategory(list, section),
    pending: stateWrite.isPending,
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
  const saving = useBranchServiceCategorySavePending(scope);
  return (
    <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4 text-start">
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
      {section.selected ? (
        <BranchServiceCategoryPanel
          key={`${section.selected.id}:${section.selected.revision}`}
          {...scope}
          record={section.selected}
          onShared={outcomes.onShared}
          onReload={outcomes.reload}
          onClose={() => section.setSelected(null)}
          onSeeAvailable={() => section.switchView('available')}
        />
      ) : null}
      <BranchServiceCategoriesTable
        list={list}
        branchId={scope.branchId}
        view={section.view}
        pending={outcomes.pending}
        cursor={section.cursor}
        onPage={section.changePage}
        onState={outcomes.writeState}
        onManage={(id) => {
          const item = list.data?.items.find((row) => row.id === id);
          if (item) section.manageRow(item);
        }}
      />
    </fieldset>
  );
}
