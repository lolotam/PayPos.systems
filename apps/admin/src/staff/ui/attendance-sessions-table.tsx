'use client';
import type { AttendanceBoard } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { DataTableFrame } from '@pospay/ui';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { attendanceSessionColumns } from './attendance-session-columns';
export function AttendanceSessionsTable({ board }: { board: AttendanceBoard }) {
  'use no memo';
  const locale = useLocale();
  const columns = useMemo(
    () => attendanceSessionColumns(locale, board.timezone),
    [locale, board.timezone],
  );
  const table = useReactTable({
    data: board.sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    getRowId: (row) => row.id,
  });
  return (
    <section aria-labelledby="attendance-sessions" className="flex min-w-0 flex-col gap-3">
      <h2 id="attendance-sessions" className="text-lg font-semibold">
        {t(locale, 'attendanceBoard.sessions')}
      </h2>
      {board.sessions.length === 0 ? (
        <p>{t(locale, 'attendanceBoard.emptySessions')}</p>
      ) : (
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
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableFrame>
      )}
    </section>
  );
}
