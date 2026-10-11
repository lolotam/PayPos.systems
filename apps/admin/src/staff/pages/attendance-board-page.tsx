'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { localDate, t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceBoard, type AttendanceBoardScope } from '../api/use-attendance-board';
import { boardAccessLost, boardTime } from '../model/attendance-board-display';
import { AttendanceBoardFilters } from '../ui/attendance-board-filters';
import { AttendanceBoardFeedback } from '../ui/attendance-board-feedback';
import { AttendanceInNow } from '../ui/attendance-in-now';
import { AttendanceRefusals } from '../ui/attendance-refusals';
import { AttendanceSessionsTable } from '../ui/attendance-sessions-table';
type Props = {
  scope: AttendanceBoardScope;
  branches: WorkspaceBranch[];
  date: string | undefined;
  onDate: (date: string | undefined) => void;
  onBranch: (branchId: string) => void;
};
export function AttendanceBoardPage({ scope, branches, date, onDate, onBranch }: Props) {
  const locale = useLocale();
  const { board, refusals } = useAttendanceBoard(scope, date);
  const data = board.data;
  const visible = data && !boardAccessLost(board.error);
  const timezone = branches.find((branch) => branch.id === scope.branchId)?.effective_timezone;
  const today = data
    ? localDate(new Date(data.generated_at), data.timezone)
    : timezone
      ? localDate(new Date(), timezone)
      : undefined;
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'attendanceBoard.title')} />
      <AttendanceBoardFilters
        branches={branches}
        branchId={scope.branchId}
        date={date ?? data?.date ?? today ?? ''}
        today={today}
        onDate={onDate}
        onBranch={onBranch}
      />
      <AttendanceBoardFeedback
        error={board.error}
        hasData={Boolean(visible)}
        loading={board.isPending}
        fetching={board.isFetching}
        onRetry={() => {
          void board.refetch();
        }}
      />
      {visible ? (
        <>
          <p className="text-xs text-muted-foreground">
            {t(locale, 'attendanceBoard.lastUpdated')}:{' '}
            {boardTime(data.generated_at, locale, data.timezone)}
          </p>
          <AttendanceInNow board={data} />
          <AttendanceSessionsTable board={data} scope={scope} />
          <AttendanceRefusals
            board={data}
            pages={refusals.data?.pages}
            error={refusals.error}
            loading={refusals.isPending}
            fetching={refusals.isFetching}
            hasMore={refusals.hasNextPage}
            onMore={() => {
              void refusals.fetchNextPage();
            }}
            onRetry={() => {
              void refusals.refetch();
            }}
          />
        </>
      ) : null}
    </section>
  );
}
