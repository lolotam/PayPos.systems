'use client';
import type { ServiceCategoryBranchPage } from '@pospay/contracts';
import type { Table } from '@tanstack/react-table';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { BranchServiceCategoryRow } from './branch-service-category-row';

type BranchCategoryRow = ServiceCategoryBranchPage['items'][number];

export function BranchServiceCategoriesFrame({
  table,
  branchId,
}: {
  table: Table<BranchCategoryRow>;
  branchId: string;
}) {
  const locale = useLocale();
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
