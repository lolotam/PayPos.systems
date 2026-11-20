'use client';
import type { ServiceCategoryBranchPage } from '@pospay/contracts';
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
];

export function BranchServiceCategoriesTable({
  list,
  branchId,
  cursor,
  onPage,
}: {
  list: UseQueryResult<ServiceCategoryBranchPage>;
  branchId: string;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
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
        <BranchServiceCategoriesFrame table={table} branchId={branchId} />
      ) : (
        <EmptyState icon={<Store />} title={t(locale, 'catalogServiceCategories.empty')} />
      )}
      <ServicesPageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
