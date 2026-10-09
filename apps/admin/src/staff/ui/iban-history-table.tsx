'use client';
import type { EmployeeIbanHistoryEntry } from '@pospay/contracts';
import { findGccBank, formatIbanForDisplay } from '@pospay/domain';
import { formatInstant, t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';

export function IbanHistoryTable({ items }: { items: EmployeeIbanHistoryEntry[] }) {
  'use no memo';
  const locale = useLocale();
  const table = useReactTable({
    data: items,
    columns: ibanColumns(locale),
    getRowId: (row) => String(row.revision),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'employeeIban.history')}>
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
    </DataTableFrame>
  );
}

function ibanColumns(locale: ReturnType<typeof useLocale>): ColumnDef<EmployeeIbanHistoryEntry>[] {
  return [
    { accessorKey: 'revision', header: t(locale, 'employeeIban.revision') },
    {
      accessorKey: 'iban',
      header: t(locale, 'employeeIban.iban'),
      cell: ({ row }) =>
        row.original.iban ? (
          <span dir="ltr">{formatIbanForDisplay(row.original.iban)}</span>
        ) : (
          t(locale, 'employeeIban.cleared')
        ),
    },
    {
      accessorKey: 'bank_id',
      header: t(locale, 'employeeIban.bank'),
      cell: ({ row }) => {
        const bank = findGccBank(row.original.bank_id ?? '');
        return bank ? (locale === 'ar' ? bank.nameAr : bank.nameEn) : '';
      },
    },
    { accessorKey: 'holder_name_en', header: t(locale, 'employeeIban.holder') },
    { accessorKey: 'reason', header: t(locale, 'employeeIban.reason') },
    {
      accessorKey: 'set_at',
      header: t(locale, 'employeeIban.date'),
      cell: ({ row }) => formatInstant(new Date(row.original.set_at), locale, 'UTC'),
    },
    { accessorKey: 'set_by', header: t(locale, 'employeeIban.actor') },
  ];
}
