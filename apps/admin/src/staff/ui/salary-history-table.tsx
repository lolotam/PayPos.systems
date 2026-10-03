'use client';
import type { EmployeeSalary } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
export function SalaryHistoryTable({ items }: { items: EmployeeSalary[] }) {
  'use no memo';
  const locale = useLocale();
  const table = useReactTable({
    data: items,
    columns: [
      { accessorKey: 'effective_from', header: t(locale, 'salary.date') },
      { accessorKey: 'amount', header: t(locale, 'salary.amount') },
      { accessorKey: 'revision', header: t(locale, 'salary.revision') },
      { accessorKey: 'reason', header: t(locale, 'salary.reason') },
    ],
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'salary.title')}>
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
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
