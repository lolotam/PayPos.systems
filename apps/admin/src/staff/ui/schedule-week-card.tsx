'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { DataTableFrame } from '@pospay/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { ScheduleWeekControls } from './schedule-week-controls';
import { ScheduleListPanel } from './schedule-list-panel';
import { SchedulePaging } from './schedule-paging';

/** كرت الجدول الأسبوعي: شريط الأسبوع ثم الشبكة ثم الترقيم (القالب المشترك للقوائم). */
export function ScheduleWeekCard({
  list,
  week,
  timezone,
  cursor,
  onWeek,
  onReload,
  onPage,
  onEdit,
}: {
  list: UseQueryResult<ScheduleGrid>;
  week: string;
  timezone: string;
  cursor: string | undefined;
  onWeek: (week: string) => void;
  onReload: () => void;
  onPage: (cursor: string | undefined) => void;
  onEdit: (row: ScheduleGrid['items'][number], day: number) => void;
}) {
  return (
    <DataTableFrame
      stacked
      filters={
        <ScheduleWeekControls
          week={week}
          timezone={timezone}
          fetching={list.isFetching}
          onWeek={onWeek}
          onReload={onReload}
        />
      }
      footer={
        <SchedulePaging
          cursor={cursor}
          next={list.data?.next_cursor}
          fetching={list.isFetching}
          failed={list.isError}
          onPage={onPage}
        />
      }
    >
      <ScheduleListPanel list={list} onEdit={onEdit} />
    </DataTableFrame>
  );
}
