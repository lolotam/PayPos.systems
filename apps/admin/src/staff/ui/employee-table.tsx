'use client';
import type { EmployeeListItem, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeTableRow } from './employee-table-row';

export function EmployeeTable({
  items,
  branches,
  selectedId,
  onSelect,
}: {
  items: readonly EmployeeListItem[];
  branches: readonly WorkspaceBranch[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const columns = useMemo(
    () => [
      { id: 'name', header: t(locale, 'staff.name') },
      { id: 'role', header: t(locale, 'staff.role') },
      { id: 'branch', header: t(locale, 'staff.primaryBranch') },
      { id: 'edit', header: t(locale, 'staff.edit') },
    ],
    [locale],
  );
  // الصفحات وترتيبها مصدرها السيرفر؛ الجدول لا يعيد تقسيم القائمة محلياً.
  const table = useReactTable({
    data,
    columns,
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'staff.listTitle')}>
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
            <EmployeeTableRow
              key={original.id}
              item={original}
              branch={branches.find((branch) => branch.id === original.primary_branch_id)}
              selected={selectedId === original.id}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
