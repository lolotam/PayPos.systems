'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceReportColumns } from './attendance-report-columns';
import { AttendanceReportHeader } from './attendance-report-header';
import { StackedTable } from './stacked-table';

export function AttendanceReportTable({
  rows,
  sorting,
  onSortingChange,
}: {
  rows: AttendanceMonthlyReportRow[];
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const columns = useMemo(() => attendanceReportColumns(locale), [locale]);
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: false,
    getRowId: (row) => row.employee_id,
  });
  if (rows.length === 0) return <p className="p-4">{t(locale, 'attendanceReport.empty')}</p>;
  return (
    <StackedTable
      table={table}
      ariaLabel={t(locale, 'attendanceReport.title')}
      renderHeader={(header) => <AttendanceReportHeader key={header.id} header={header} />}
    />
  );
}
