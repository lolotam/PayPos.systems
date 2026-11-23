'use client';
import type { DocumentType } from '@pospay/contracts';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useLocale } from '@/shared/locale/locale-context';
import { documentTypeColumns } from './document-type-columns';
import type { DocumentTypeActions } from './document-type-row-actions';

// عمود الإجراءات ترويسته نص «تعديل» نفسه نص زر التعديل، فلا يحمل تسمية مكررة فوق الزر.
const ACTIONS_COLUMN = 'actions';

// الجدول بلا كرت: كرت القائمة تملكه اللوحة؛ والأدوار صريحة تبقى معتمدة بعد أن يكدّس الإطار الصفوف تحت 600px.
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
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id} role="row">
            {row.getVisibleCells().map((cell, index) => {
              const header = cell.column.columnDef.header;
              const labelled =
                index > 0 && cell.column.id !== ACTIONS_COLUMN && typeof header === 'string';
              return (
                <td key={cell.id} role="cell" data-cell-label={labelled ? header : undefined}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
