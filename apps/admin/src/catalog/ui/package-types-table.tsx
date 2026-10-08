'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { PackageTypeTableRow } from './package-type-table-row';

export function PackageTypesTable({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly PackageTypeListItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const table = useReactTable({
    data,
    columns: [
      { id: 'name', header: t(locale, 'catalogPackageTypes.nameEn') },
      { id: 'price', header: t(locale, 'catalogPackageTypes.price') },
      { id: 'validity', header: t(locale, 'catalogPackageTypes.validity') },
      { id: 'components', header: t(locale, 'catalogPackageTypes.componentCount') },
      { id: 'edit', header: t(locale, 'catalogPackageTypes.edit') },
    ],
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'catalogPackageTypes.listTitle')}>
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
            <PackageTypeTableRow
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
