'use client';
import type { ServiceCategoryClosingAction, ServiceCategoryListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceCategoryRow } from './service-category-row';

export function ServiceCategoriesTable({
  items,
  selectedId,
  tracked,
  onSelect,
}: {
  items: readonly ServiceCategoryListItem[];
  selectedId: string;
  tracked: { categoryId: string; action: ServiceCategoryClosingAction } | null;
  onSelect: (id: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const table = useReactTable({
    data,
    columns: [
      { id: 'name', header: t(locale, 'catalogServiceCategories.listTitle') },
      { id: 'visibility', header: t(locale, 'catalogServiceCategories.visibility') },
      { id: 'state', header: t(locale, 'catalogServiceCategories.state') },
      { id: 'manage', header: t(locale, 'catalogServiceCategories.manage') },
    ],
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'catalogServiceCategories.listTitle')}>
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
          {table.getRowModel().rows.map(({ original }) => (
            <ServiceCategoryRow
              key={original.id}
              item={original}
              selected={selectedId === original.id}
              pendingAction={tracked?.categoryId === original.id ? tracked.action : null}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
