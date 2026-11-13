'use client';
import type { LeaveHistoryItem, WorkspaceBranch } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { leaveReportColumns } from './leave-report-columns';

function branchName(branch: WorkspaceBranch, locale: Locale): string {
  return locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en;
}

export function LeaveReportRowsTable({
  items,
  branches,
}: {
  items: LeaveHistoryItem[];
  branches: WorkspaceBranch[];
}) {
  'use no memo';
  const locale = useLocale();
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branchName(branch, locale)] as const)),
    [branches, locale],
  );
  const columns = useMemo<ColumnDef<LeaveHistoryItem>[]>(
    () => leaveReportColumns(locale, branchNames),
    [locale, branchNames],
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
