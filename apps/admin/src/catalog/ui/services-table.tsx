'use client';
import type { ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ServiceTableRow } from './service-table-row';

export function ServicesTable({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly ServiceListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const table = useReactTable({
    data,
    columns: [
      { id: 'name', header: t(locale, 'catalogServices.nameEn') },
      { id: 'price', header: t(locale, 'catalogServices.price') },
      { id: 'rule', header: t(locale, 'catalogServices.rule') },
      { id: 'edit', header: t(locale, 'catalogServices.edit') },
    ],
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'catalogServices.listTitle')}>
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
            <ServiceTableRow
              key={original.id}
              item={original}
              selected={selectedId === original.id}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
