'use client';
import { flexRender, type Cell, type Header, type Row, type Table } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { stackedCellContent } from '../model/stacked-cell';

type Props<T> = {
  table: Table<T>;
  ariaLabel?: string;
  /** أعمدة محتواها إجراء فقط: لا تسمية فوقها حتى لا تتكرر مع نص الزر. */
  unlabelled?: readonly string[];
  /** ترويسة خاصة (فرز مثلًا)؛ تغيب فتُرسم ترويسة النص. */
  renderHeader?: (header: Header<T, unknown>) => ReactNode;
  /** تسمية صف مكدّس تخالف عنوان العمود لخلية بعينها (عمود يحمل معنيين بحسب نوع الصف). */
  cellLabel?: (cell: Cell<T, unknown>) => string | undefined;
};

function bodyCell<T>(
  cell: Cell<T, unknown>,
  first: boolean,
  unlabelled: readonly string[],
  cellLabel: Props<T>['cellLabel'],
) {
  const { label, content } = stackedCellContent(
    cell,
    first || unlabelled.includes(cell.column.id),
    cellLabel?.(cell),
  );
  return (
    <td key={cell.id} role="cell" data-cell-label={label} className="max-[599.99px]:empty:py-0">
      {content}
    </td>
  );
}

function bodyRow<T>(row: Row<T>, unlabelled: readonly string[], cellLabel: Props<T>['cellLabel']) {
  return (
    <tr key={row.id} role="row">
      {row
        .getVisibleCells()
        .map((cell, index) => bodyCell(cell, index === 0, unlabelled, cellLabel))}
    </tr>
  );
}

function headCell<T>(header: Header<T, unknown>) {
  return (
    <th key={header.id} scope="col" role="columnheader">
      {flexRender(header.column.columnDef.header, header.getContext())}
    </th>
  );
}

/**
 * جدول بلا كرت: كرت القائمة تملكه الصفحة كي يجلس معه التصفية والتذييل.
 * الأدوار صريحة كي يبقى قارئ الشاشة يقرأه جدولًا بعد أن تتحول الصفوف إلى بلوكات تحت 600px،
 * والترويسة تبقى في الشجرة (مخفية بصريًا هناك) فتربط كل خلية بعمودها.
 */
export function StackedTable<T>({
  table,
  ariaLabel,
  unlabelled = [],
  renderHeader,
  cellLabel,
}: Props<T>) {
  'use no memo';
  return (
    <table role="table" {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
      <thead role="rowgroup">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id} role="row">
            {group.headers.map((header) => renderHeader?.(header) ?? headCell(header))}
          </tr>
        ))}
      </thead>
      <tbody role="rowgroup">
        {table.getRowModel().rows.map((row) => bodyRow(row, unlabelled, cellLabel))}
      </tbody>
    </table>
  );
}
