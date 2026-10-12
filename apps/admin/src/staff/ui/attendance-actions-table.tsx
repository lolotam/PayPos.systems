'use client';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceActionsTable<T extends { id: string }>({
  items,
  columns,
}: {
  items: T[];
  columns: ColumnDef<T>[];
}) {
  'use no memo';
  const locale = useLocale();
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => row.id,
  });
  if (!items.length) return <p>{t(locale, 'attendanceActions.empty')}</p>;
  return (
    <DataTableFrame>
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
