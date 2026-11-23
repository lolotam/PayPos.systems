'use client';

import { flexRender, type Table } from '@tanstack/react-table';

/**
 * جدول بأدوار صريحة تبقى معتمدة بعد أن يكدّس الإطار الصفوف تحت 600px: الخلية الأولى عنوان
 * البطاقة بلا تسمية، وكل خلية بعدها تحمل تسمية عمودها، والعمود بترويسة فاضية (زر التعديل) بلا تسمية.
 */
export function StackedCommissionTable<T>({ table }: { table: Table<T> }) {
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
              return (
                <td
                  key={cell.id}
                  role="cell"
                  data-cell-label={index > 0 && typeof header === 'string' ? header : undefined}
                >
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
