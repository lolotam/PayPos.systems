'use client';
import type {
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchPage,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
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
  view,
  pending,
  onState,
  onManage,
}: {
  table: Table<BranchCategoryRow>;
  branchId: string;
  view: ServiceCategoryBranchView;
  pending: boolean;
  onState: (item: ServiceCategoryBranchListItem, state: ServiceCategoryBranchSettingState) => void;
  onManage: (categoryId: string) => void;
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
            <BranchServiceCategoryRow
              key={original.id}
              item={original}
              branchId={branchId}
              view={view}
              pending={pending}
              onState={onState}
              onManage={onManage}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
