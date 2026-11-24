'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale } from '@/shared/locale/locale-context';
import { scheduleDayKeys } from '../model/schedule-form';
type Row = ScheduleGrid['items'][number];
type EditSchedule = (row: Row, day: number) => void;
type DayKey = (typeof scheduleDayKeys)[number];
/** عنوان عمود اليوم: اسم اليوم وتاريخه؛ أول خلية بلا تسمية لأنها عنوان البطاقة المكدّسة. */
function dayLabel(locale: Locale, days: string[], key: DayKey, day: number): string {
  return `${t(locale, `shell.schedule_${key}`)} ${days[day] ?? ''}`;
}
function dayLabels(locale: Locale, days: string[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  scheduleDayKeys.forEach((key, day) => {
    labels.set(key, dayLabel(locale, days, key, day));
  });
  return labels;
}
function dayCell(locale: Locale, days: string[], row: Row, day: number, onEdit: EditSchedule) {
  const shifts = row.schedule?.shifts.filter((s) => s.day === day) ?? [];
  return (
    <Button
      variant="ghost"
      className="h-auto min-h-12 min-w-24 flex-col gap-1 tabular-nums"
      aria-label={`${t(locale, 'shell.schedule_edit')} ${row.name_en} ${days[day] ?? ''}`}
      onClick={() => onEdit(row, day)}
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
}
function gridColumns(
  locale: Locale,
  days: string[],
  onEdit: EditSchedule,
): ColumnDef<Row>[] {
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
      header: dayLabel(locale, days, key, day),
      cell: ({ row }) => dayCell(locale, days, row.original, day, onEdit),
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
  const labels = useMemo(() => dayLabels(locale, data.days), [locale, data.days]);
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
              <td key={cell.id} data-cell-label={labels.get(cell.column.id)}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
