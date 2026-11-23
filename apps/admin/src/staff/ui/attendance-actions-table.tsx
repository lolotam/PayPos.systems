'use client';
import { t } from '@pospay/i18n';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { StackedTable } from './stacked-table';

// عمود الإجراءات يحمل أزرارًا فقط، فلا تسمية فوقه تتكرر مع نص الزر.
const ACTION_COLUMNS = ['actions'] as const;

// الجدول بلا كرت: الصفحة تملك الكرت ليجلس معه التصفية والتذييل.
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
  if (!items.length) return <p className="p-4">{t(locale, 'attendanceActions.empty')}</p>;
  return <StackedTable table={table} unlabelled={ACTION_COLUMNS} />;
}
