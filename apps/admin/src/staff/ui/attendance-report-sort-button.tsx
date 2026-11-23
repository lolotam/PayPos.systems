'use client';
import type { AttendanceMonthlyReportRow } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { flexRender, type Header } from '@tanstack/react-table';
import { useLayoutEffect, useRef } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { isStackedWidth } from './use-stacked-width';

/**
 * زر فرز العمود في الترويسة العريضة.
 * يزول الزر لما يصير العرض مكدّسًا؛ فإن كان التركيز عليه لحظتها ننقله إلى مربع «الترتيب حسب»
 * بدل أن يضيع على عنصر محذوف، لأن المربع صار أداة الفرز الوحيدة هناك.
 */
export function AttendanceReportSortButton({
  header,
}: {
  header: Header<AttendanceMonthlyReportRow, unknown>;
}) {
  const locale = useLocale();
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const own = button.current;
    return () => {
      if (own && document.activeElement === own && isStackedWidth()) {
        document.getElementById('report-sort')?.focus();
      }
    };
  }, []);
  return (
    <Button
      ref={button}
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
