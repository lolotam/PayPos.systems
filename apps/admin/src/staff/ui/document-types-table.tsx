'use client';
import type { DocumentType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { documentTypeColumns } from './document-type-columns';
import type { DocumentTypeActions } from './document-type-row-actions';

export function DocumentTypesTable({
  items,
  ...actions
}: DocumentTypeActions & { items: DocumentType[] }) {
  'use no memo';
  const locale = useLocale();
  const table = useReactTable({
    data: items,
    columns: documentTypeColumns(locale, actions),
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return (
    <DataTableFrame title={t(locale, 'employeeDocuments.typesTitle')}>
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
