'use client';

import type { CommissionPlanVersion } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { planHistoryColumns } from './plan-history-columns';

interface PlanHistoryTableProps {
  items: readonly CommissionPlanVersion[];
  timeZone: string;
  hasNextPage: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore(): void;
}

/** تاريخ نسخ الخطة بترقيم صفحات من السيرفر: الأحدث فوق، وزرار تحميل بيلحق بالترتيب نفسه. */
export function PlanHistoryTable({
  items,
  timeZone,
  hasNextPage,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: PlanHistoryTableProps) {
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  // هوية الأعمدة الثابتة شرط في TanStack Table: مصفوفة جديدة كل رسم بتتعامل كتغيير نموذج.
  const columns = useMemo(() => planHistoryColumns(locale, timeZone), [locale, timeZone]);
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  const loadMore = hasNextPage ? (
    <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
      {t(locale, 'commissionPlanBuilder.loadMore')}
    </Button>
  ) : null;
  return (
    <DataTableFrame title={t(locale, 'commissionPlanBuilder.historyTitle')} action={loadMore}>
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
      {loadMoreError ? (
        <p role="alert" className="px-4 py-3">
          {t(locale, 'commissionPlanBuilder.couldNotLoadMore')}
        </p>
      ) : null}
    </DataTableFrame>
  );
}
