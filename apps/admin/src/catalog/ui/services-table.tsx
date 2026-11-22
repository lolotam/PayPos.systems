'use client';
import type { ServiceListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ServiceTableRow } from './service-table-row';

// الجدول بلا كرت: كرت القائمة يملكه الـ`ServicesListPanel` عشان التصفية والتذييل
// يجلسوا مع الجدول في نفس الكرت، والجدول نفسه فقط هو ما يُمرَّر داخله.
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
      { id: 'duration', header: t(locale, 'catalogServices.durationColumn') },
      { id: 'category', header: t(locale, 'catalogServices.categoryColumn') },
      { id: 'rule', header: t(locale, 'catalogServices.rule') },
      { id: 'edit', header: t(locale, 'catalogServices.edit') },
    ],
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
          <ServiceTableRow
            key={original.id}
            item={original}
            selected={selectedId === original.id}
            onSelect={onSelect}
          />
        ))}
      </tbody>
    </table>
  );
}
