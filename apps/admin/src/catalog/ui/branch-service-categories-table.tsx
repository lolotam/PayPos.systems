'use client';
import type { ServiceCategoryBranchPage } from '@pospay/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Table } from '@tanstack/react-table';
import { t, type Locale } from '@pospay/i18n';
import { CircleAlert, DataTableFrame, EmptyState, LoaderCircle, Store } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { BranchServiceCategoryRow } from './branch-service-category-row';
import { ServicesPageNavigation } from './services-page-navigation';

type BranchCategoryTable = Table<ServiceCategoryBranchPage['items'][number]>;

const columns = (locale: Locale) => [
  { id: 'name', header: t(locale, 'catalogServiceCategories.listTitle') },
  { id: 'visibility', header: t(locale, 'catalogServiceCategories.visibility') },
  { id: 'marks', header: t(locale, 'catalogServiceCategoryBranches.branchColumn') },
];

function categoriesFrame(table: BranchCategoryTable, branchId: string, locale: Locale) {
  return (
    <DataTableFrame title={t(locale, 'catalogServiceCategories.listTitle')}>
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(({ original }) => (
            <BranchServiceCategoryRow key={original.id} item={original} branchId={branchId} />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}

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
        categoriesFrame(table, branchId, locale)
      ) : (
        <EmptyState icon={<Store />} title={t(locale, 'catalogServiceCategories.empty')} />
      )}
      <ServicesPageNavigation cursor={cursor} next={list.data.next_cursor} onChange={onPage} />
    </div>
  );
}
