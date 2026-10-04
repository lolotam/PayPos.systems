'use client';
import type { LeavePage } from '@pospay/contracts';
import { t, formatDate, type Locale } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
type Row = LeavePage['items'][number];
function leaveColumns(
  locale: Locale,
  pending: boolean,
  onCancel: (row: Row) => void,
): ColumnDef<Row>[] {
  const date = (civil: string) =>
    formatDate(new Date(`${civil}T12:00Z`), { locale, calendar: 'gregorian', timeZone: 'UTC' });
  return [
    {
      id: 'period',
      header: t(locale, 'leave.date'),
      cell: ({ row: { original: r } }) => (
        <span>
          {date(r.from)}–{date(r.to)}
          {r.start ? (
            <span dir="ltr">
              {' '}
              {r.start}–{r.end}
            </span>
          ) : null}
          <span className="block text-xs text-muted-foreground">{r.timezone}</span>
        </span>
      ),
    },
    {
      id: 'type',
      header: t(locale, 'leave.type'),
      cell: ({ row }) => t(locale, `leave.${row.original.type}`),
    },
    {
      id: 'status',
      header: t(locale, 'leave.status'),
      cell: ({ row }) => t(locale, `leave.${row.original.status}`),
    },
    {
      id: 'cancel',
      header: t(locale, 'leave.cancel'),
      cell: ({ row }) =>
        row.original.can_cancel ? (
          <Button variant="outline" disabled={pending} onClick={() => onCancel(row.original)}>
            {t(locale, 'leave.cancel')}
          </Button>
        ) : null,
    },
  ];
}
export function LeaveHistoryTable({
  items,
  pending,
  onCancel,
}: {
  items: Row[];
  pending: boolean;
  onCancel: (row: Row) => void;
}) {
  'use no memo';
  const locale = useLocale();
  const columns = useMemo<ColumnDef<Row>[]>(
    () => leaveColumns(locale, pending, onCancel),
    [locale, pending, onCancel],
  );
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (r) => r.id,
  });
  return (
    <DataTableFrame>
      <table>
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id} scope="col">
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableFrame>
  );
}
