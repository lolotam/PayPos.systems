'use client';
import type { LeaveHistoryItem } from '@pospay/contracts';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { leaveHistoryColumns, type LeaveHistoryActions } from './leave-history-columns';

export function LeaveHistoryRowsTable({
  items,
  pending,
  onCancel,
  onDecide,
  onRevoke,
}: {
  items: LeaveHistoryItem[];
  pending: boolean;
} & LeaveHistoryActions) {
  'use no memo';
  const locale = useLocale();
  const columns = useMemo<ColumnDef<LeaveHistoryItem>[]>(
    () => leaveHistoryColumns(locale, pending, { onCancel, onDecide, onRevoke }),
    [locale, pending, onCancel, onDecide, onRevoke],
  );
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => `${row.row_type}:${row.id}`,
  });
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
