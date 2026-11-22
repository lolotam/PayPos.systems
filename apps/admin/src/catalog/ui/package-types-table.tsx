'use client';
import type { PackageTypeListItem } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { PackageTypeTableRow } from './package-type-table-row';
import { packageTypesTableColumns } from './package-types-table-columns';

// الجدول بلا كرت: كرت القائمة يملكه الـ`PackageTypesListPanel` عشان التذييل يجلس مع الجدول في نفس الكرت.
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
    // الأدوار صريحة تبقى معتمدة بعد أن يغيّر التكديس عرض العناصر تحت 600px،
    // وتربط كل خلية بترويسة عمودها لقارئ الشاشة حتى والترويسة مخفية بصريًا.
    <table role="table">
      <thead role="rowgroup">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} role="row">
            {group.headers.map((header) => (
              <th key={header.id} scope="col" role="columnheader">
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody role="rowgroup">
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
  );
}
