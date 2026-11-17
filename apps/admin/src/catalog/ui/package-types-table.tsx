'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { PackageTypeTableRow } from './package-type-table-row';
import { packageTypesTableColumns } from './package-types-table-columns';

export function PackageTypesTable({
  items,
  canManage,
  companyId,
  businessId,
  userId,
  selectedId,
  onSelect,
}: {
  items: readonly PackageTypeListItem[];
  canManage: boolean;
  companyId: string;
  businessId: string;
  userId: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const table = useReactTable({
    data,
    columns: packageTypesTableColumns(locale),
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
              canManage={canManage}
              companyId={companyId}
              businessId={businessId}
              userId={userId}
              selected={selectedId === original.id}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
