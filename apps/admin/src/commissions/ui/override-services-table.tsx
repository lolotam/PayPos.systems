'use client';

import type { CommissionOverrideServiceItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { overrideServicesColumns } from './override-services-columns';
import { StackedCommissionTable } from './stacked-commission-table';

interface OverrideServicesTableProps {
  items: readonly CommissionOverrideServiceItem[];
  hasNextPage: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore(): void;
  onEdit(item: CommissionOverrideServiceItem): void;
}

/** جدول خدمات الشاشة: صف لكل خدمة بقاعدة الخدمة وقاعدة التجاوز الحالية، وزر تعديل لكل سطر. */
export function OverrideServicesTable({
  items,
  hasNextPage,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onEdit,
}: OverrideServicesTableProps) {
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  // هوية الأعمدة الثابتة شرط في TanStack Table: مصفوفة جديدة كل رسم بتتعامل كتغيير نموذج.
  const columns = useMemo(() => overrideServicesColumns(locale, onEdit), [locale, onEdit]);
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.service_id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  const loadMore = hasNextPage ? (
    <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
      {t(locale, 'commissionOverrides.loadMore')}
    </Button>
  ) : null;
  return (
    <DataTableFrame stacked footer={loadMore}>
      <StackedCommissionTable table={table} />
      {loadMoreError ? <p role="alert" className="px-4 py-3">{t(locale, 'commissionOverrides.couldNotLoadMore')}</p> : null}
    </DataTableFrame>
  );
}
