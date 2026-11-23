'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { flexRender, type Header } from '@tanstack/react-table';
import { AttendanceReportSortButton } from './attendance-report-sort-button';
import { useStackedWidth } from './use-stacked-width';

export function AttendanceReportHeader({
  header,
}: {
  header: Header<AttendanceMonthlyReportRow, unknown>;
}) {
  // تحت 600px ترويسة الجدول مخفية بصريًا ومربع «الترتيب حسب» هو أداة الفرز الوحيدة، فنص العمود فقط.
  const stacked = useStackedWidth();
  const sorted = header.column.getIsSorted();
  return (
    <th
      scope="col"
      role="columnheader"
      data-sort-column={header.column.id}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
    >
      {header.column.getCanSort() && !stacked ? (
        <AttendanceReportSortButton header={header} />
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </th>
  );
}
