'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { flexRender, type Header } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { useStackedWidth } from './use-stacked-width';

export function AttendanceReportHeader({
  header,
}: {
  header: Header<AttendanceMonthlyReportRow, unknown>;
}) {
  const locale = useLocale();
  const stacked = useStackedWidth();
  const sorted = header.column.getIsSorted();
  return (
    <th
      scope="col"
      role="columnheader"
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
    >
      {header.column.getCanSort() ? (
        <Button
          variant="ghost"
          // تحت 600px الترويسة مخفية بصريًا ومربع الفرز هو أداة الفرز الوحيدة، فيخرج الزر من ترتيب Tab ويبقى اسم العمود.
          {...(stacked ? { tabIndex: -1 } : {})}
          onClick={header.column.getToggleSortingHandler()}
          title={t(
            locale,
            header.column.getNextSortingOrder() === 'desc'
              ? 'attendanceReport.sortDescending'
              : 'attendanceReport.sortAscending',
          )}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </Button>
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </th>
  );
}
