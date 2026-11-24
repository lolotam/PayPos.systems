'use client';
import type { EmployeeListItem, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeTableRow } from './employee-table-row';

export function EmployeeTable({
  items,
  branches,
}: {
  items: readonly EmployeeListItem[];
  branches: readonly WorkspaceBranch[];
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const columns = useMemo(
    () => [
      { id: 'number', header: t(locale, 'staff.employeeNumber') },
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
    // الأدوار صريحة تبقى معتمدة بعد أن يكدّس الإطار الصفوف تحت 600px؛ كرت القائمة تملكه اللوحة.
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
          <EmployeeTableRow
            key={original.id}
            item={original}
            branch={branches.find((branch) => branch.id === original.primary_branch_id)}
          />
        ))}
      </tbody>
    </table>
  );
}
