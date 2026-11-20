'use client';
import type {
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchPage,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { t, type Locale } from '@pospay/i18n';
import { CircleAlert, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { BranchServiceCategoriesFrame } from './branch-service-categories-frame';
import { ServicesPageNavigation } from './services-page-navigation';

const columns = (locale: Locale) => [
  { id: 'name', header: t(locale, 'catalogServiceCategories.listTitle') },
  { id: 'visibility', header: t(locale, 'catalogServiceCategories.visibility') },
  { id: 'marks', header: t(locale, 'catalogServiceCategoryBranches.branchColumn') },
  { id: 'actions', header: '' },
];

export function BranchServiceCategoriesTable({
  list,
  branchId,
  view,
  pending,
  cursor,
  onPage,
  onState,
  onManage,
}: {
  list: UseQueryResult<ServiceCategoryBranchPage>;
  branchId: string;
  view: ServiceCategoryBranchView;
  pending: boolean;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
  onState: (item: ServiceCategoryBranchListItem, state: ServiceCategoryBranchSettingState) => void;
  onManage: (categoryId: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...(list.data?.items ?? [])], [list.data]);
  const table = useReactTable({
    data,
    columns: columns(locale),
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  if (list.isPending)
    return <EmptyState role="status" icon={<LoaderCircle />} title={t(locale, 'admin.loading')} />;
  if (list.isError)
    return (
      <EmptyState
        role="alert"
        tone="danger"
        icon={<CircleAlert />}
        title={envelopeMessage(list.error, locale)}
      />
    );
  return (
    <div className="flex flex-col gap-4">
      {list.data.items.length ? (
        <BranchServiceCategoriesFrame
          table={table}
          branchId={branchId}
          view={view}
          pending={pending}
          onState={onState}
          onManage={onManage}
        />
      ) : (
        <EmptyState icon={<Store />} title={t(locale, 'catalogServiceCategories.empty')} />
      )}
      <ServicesPageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
