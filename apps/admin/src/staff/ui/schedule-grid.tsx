'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
type Row = ScheduleGrid['items'][number];
export const scheduleDayKeys = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
type EditSchedule = (row: Row, day: number) => void;
function gridColumns(locale: Locale, days: string[], onEdit: EditSchedule): ColumnDef<Row>[] {
  return [
    {
      id: 'employee',
      header: t(locale, 'shell.schedule_employee'),
      cell: ({ row }) => (
        <div>
          {locale === 'ar' ? (row.original.name_ar ?? row.original.name_en) : row.original.name_en}
          <Link
            className="block text-sm underline"
            href={`/staff/${row.original.employee_id}/leave`}
          >
            {t(locale, 'leave.title')}
          </Link>
          {row.original.schedule ? (
            <p dir="ltr" className="text-xs text-muted-foreground">
              {row.original.schedule.timezone}
            </p>
          ) : null}
        </div>
      ),
    },
    ...scheduleDayKeys.map((key, day): ColumnDef<Row> => ({
      id: key,
      header: `${t(locale, `shell.schedule_${key}`)} ${days[day] ?? ''}`,
      cell: ({ row }) => {
        const shifts = row.original.schedule?.shifts.filter((s) => s.day === day) ?? [];
        return (
          <Button
            variant="ghost"
            className="h-auto min-h-12 min-w-24 flex-col gap-1 tabular-nums"
            aria-label={`${t(locale, 'shell.schedule_edit')} ${row.original.name_en} ${days[day] ?? ''}`}
            onClick={() => onEdit(row.original, day)}
          >
            {shifts.length > 0
              ? shifts.map((s) => (
                  <span key={s.start}>
                    <span dir="ltr">
                      {s.start}–{s.end}
                    </span>
                    {s.break_start && s.break_end ? (
                      <span className="block text-xs text-muted-foreground">
                        {t(locale, 'shell.schedule_break')}{' '}
                        <span dir="ltr">
                          {s.break_start}–{s.break_end}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ))
              : t(locale, 'shell.schedule_off')}
          </Button>
        );
      },
    })),
  ];
}
export function ScheduleGridTable({
  data,
  onEdit,
}: {
  data: ScheduleGrid;
  onEdit: (row: Row, day: number) => void;
}) {
  const locale = useLocale();
  const columns = useMemo(
    () => gridColumns(locale, data.days, onEdit),
    [locale, data.days, onEdit],
  );
  const table = useReactTable({
    data: data.items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => row.employee_id,
  });
  return (
    <DataTableFrame>
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
