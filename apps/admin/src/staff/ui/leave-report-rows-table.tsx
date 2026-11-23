'use client';
import type { LeaveHistoryItem, WorkspaceBranch } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { leaveReportColumns } from './leave-report-columns';
import { StackedTable } from './stacked-table';

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
    <StackedTable
      table={table}
      // خانة التفاصيل تعرض سبب القرار لصفوف الإجازة، وأوقات الشيفت لصفوف الغياب والتغطية خارج الفرع.
      cellLabel={(cell) =>
        cell.column.id === 'details' && cell.row.original.row_type !== 'LEAVE'
          ? t(locale, 'attendanceStatementScreen.shift')
          : undefined
      }
    />
  );
}
