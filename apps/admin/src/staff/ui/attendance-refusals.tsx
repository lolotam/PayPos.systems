'use client';
import type { AttendanceBoard, AttendanceDeviceRefusalPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceBoardFeedback } from './attendance-board-feedback';
import { AttendanceRefusalRow } from './attendance-refusal-row';
export function AttendanceRefusals({
  board,
  pages,
  error,
  loading,
  fetching,
  hasMore,
  onMore,
  onRetry,
}: {
  board: AttendanceBoard;
  pages: AttendanceDeviceRefusalPage[] | undefined;
  error: unknown;
  loading: boolean;
  fetching: boolean;
  hasMore: boolean;
  onMore: () => void;
  onRetry: () => void;
}) {
  const locale = useLocale();
  const items = [
    ...new Map(pages?.flatMap((page) => page.items).map((row) => [row.id, row])).values(),
  ];
  const visible = !boardAccessLost(error);
  return (
    <section aria-labelledby="attendance-refusals" className="flex flex-col gap-3">
      <h2 id="attendance-refusals" className="text-lg font-semibold">
        {t(locale, 'attendanceBoard.refusals')}
      </h2>
      <AttendanceBoardFeedback
        error={error}
        hasData={Boolean(pages && visible)}
        loading={loading}
        fetching={fetching}
        onRetry={onRetry}
      />
      {pages && visible && items.length === 0 ? (
        <p>{t(locale, 'attendanceBoard.emptyRefusals')}</p>
      ) : null}
      {visible ? (
        <ul className="flex flex-col gap-3">
          {items.map((row) => (
            <AttendanceRefusalRow key={row.id} board={board} row={row} />
          ))}
        </ul>
      ) : null}
      {hasMore && visible ? (
        <Button variant="outline" onClick={onMore} disabled={fetching}>
          {t(locale, 'attendanceBoard.loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
