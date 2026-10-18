'use client';
import type { EmployeeNumberListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { CompanyEmployeeNumberRow } from './company-employee-number-row';

type CompanyEmployeeNumbersTableProps = {
  items: readonly EmployeeNumberListItem[];
  editingId: string | undefined;
  pending: boolean;
  message: string | null;
  onEdit: (employeeId: string) => void;
  onClose: () => void;
  onSubmit: (employeeNumber: number) => void;
};

export function CompanyEmployeeNumbersTable({
  items,
  editingId,
  pending,
  message,
  onEdit,
  onClose,
  onSubmit,
}: CompanyEmployeeNumbersTableProps) {
  'use no memo';
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  const columns = useMemo(
    () => [
      { id: 'name', header: t(locale, 'companyEmployeeNumbers.name') },
      { id: 'business', header: t(locale, 'companyEmployeeNumbers.business') },
      { id: 'number', header: t(locale, 'companyEmployeeNumbers.number') },
    ],
    [locale],
  );
  // الصفحات وترتيبها مصدرها السيرفر؛ الجدول لا يعيد تقسيم القائمة محلياً.
  const table = useReactTable({
    data,
    columns,
    getRowId: (item) => item.employee_id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'companyEmployeeNumbers.title')}>
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
            <CompanyEmployeeNumberRow
              key={original.employee_id}
              item={original}
              editingId={editingId}
              pending={pending}
              message={editingId === original.employee_id ? message : null}
              onEdit={onEdit}
              onClose={onClose}
              onSubmit={onSubmit}
            />
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
