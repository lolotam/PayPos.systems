'use client';
import type { PermissionMembership } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { PermissionMembershipRow } from './permission-membership-row';

type Props = {
  items: readonly PermissionMembership[];
  selectedId: string;
  onSelect: (id: string) => void;
  scopeNames?: Readonly<Record<string, string>>;
};

export function PermissionMembershipTable({ items, selectedId, onSelect, scopeNames = {} }: Props) {
  'use no memo';
  // واجهة TanStack v8 متغيرة؛ حفظها تلقائياً بالـ compiler ممكن يثبت صفوف قديمة.
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const columns = useMemo(
    () => [
      { id: 'holder', header: t(locale, 'permissions.holder') },
      { id: 'role', header: t(locale, 'permissions.role') },
      { id: 'scope', header: t(locale, 'permissions.scope') },
      { id: 'choose', header: t(locale, 'permissions.choose') },
    ],
    [locale],
  );
  // الصفحة جاية جاهزة من السيرفر؛ الجدول ما يقسمهاش تاني ولا يغيّر ترتيبها.
  const table = useReactTable({
    data,
    columns,
    getRowId: (item) => item.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'permissions.person')}>
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
          {table.getRowModel().rows.map(({ original: item }) => (
            <PermissionMembershipRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              scopeName={scopeNames[`${item.scope_type}:${item.scope_id}`]}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
