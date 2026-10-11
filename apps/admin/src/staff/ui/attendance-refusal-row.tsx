'use client';
import type { AttendanceBoard, AttendanceDeviceRefusalPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { boardEmployeeName, boardTime } from '../model/attendance-board-display';
export function AttendanceRefusalRow({
  board,
  row,
}: {
  board: AttendanceBoard;
  row: AttendanceDeviceRefusalPage['items'][number];
}) {
  const locale = useLocale();
  return (
    <li className="rounded-xl border p-3">
      <dl className="grid gap-1 sm:grid-cols-2">
        <dt>{t(locale, 'attendanceBoard.employee')}</dt>
        <dd className="break-all">{boardEmployeeName(board, row.employee_id, locale)}</dd>
        <dt>{t(locale, 'attendanceBoard.holder')}</dt>
        <dd className="break-all">{boardEmployeeName(board, row.holder_employee_id, locale)}</dd>
        <dt>{t(locale, 'attendanceBoard.step')}</dt>
        <dd>{t(locale, `attendanceBoard.${row.step}`)}</dd>
        <dt>{t(locale, 'attendanceBoard.reason')}</dt>
        <dd>{t(locale, `attendanceBoard.${row.reason}`)}</dd>
        <dt>{t(locale, 'attendanceBoard.time')}</dt>
        <dd>{boardTime(row.attempted_at, locale, board.timezone)}</dd>
      </dl>
    </li>
  );
}
