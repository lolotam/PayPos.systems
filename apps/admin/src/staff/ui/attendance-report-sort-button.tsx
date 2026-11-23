'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { flexRender, type Header } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * زر فرز العمود في الترويسة العريضة. انتقال التركيز بينه وبين مربع «الترتيب حسب» عند عبور حدّ العرض
 * يملكه useSortFocusHandOver وحده.
 */
export function AttendanceReportSortButton({
  header,
}: {
  header: Header<AttendanceMonthlyReportRow, unknown>;
}) {
  const locale = useLocale();
  return (
    <Button
      variant="ghost"
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
  );
}
