'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceReportColumns } from './attendance-report-columns';
import { AttendanceReportHeader } from './attendance-report-header';

export function AttendanceReportTable({ rows }: { rows: AttendanceMonthlyReportRow[] }) {
  'use no memo';
  const locale = useLocale();
  const columns = useMemo(() => attendanceReportColumns(locale), [locale]);
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    sortDescFirst: false,
    getRowId: (row) => row.employee_id,
  });
  if (rows.length === 0) return <p>{t(locale, 'attendanceReport.empty')}</p>;
  return (
    <DataTableFrame>
      <table aria-label={t(locale, 'attendanceReport.title')}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <AttendanceReportHeader key={header.id} header={header} />
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
