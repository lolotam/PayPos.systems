'use client';
import type {
  ServiceCategoryBranchListItem,
  ServiceCategoryBranchPage,
  ServiceCategoryBranchSettingState,
  ServiceCategoryBranchView,
} from '@pospay/contracts';
import type { Table } from '@tanstack/react-table';
import { flexRender } from '@tanstack/react-table';
import { BranchServiceCategoryRow } from './branch-service-category-row';

type BranchCategoryRow = ServiceCategoryBranchPage['items'][number];

// الجدول بلا كرت: كرت القائمة يملكه الـ`BranchServiceCategoriesTable` عشان التبويبات والتذييل تجلس معه.
export function BranchServiceCategoriesGrid({
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
  return (
    // الأدوار صريحة تبقى معتمدة بعد أن يغيّر التكديس عرض العناصر تحت 600px.
    <table role="table">
      <thead role="rowgroup">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} role="row">
            {group.headers.map((header) => (
              <th key={header.id} scope="col" role="columnheader">
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody role="rowgroup">
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
  );
}
