'use client';
import type { ScheduleGrid, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useScheduleWeek, type ScheduleWorkspace } from '../api/use-schedules';
import { initialScheduleWeek } from '../model/schedule-form';
import { ScheduleWeekControls } from '../ui/schedule-week-controls';
import { ScheduleListPanel } from '../ui/schedule-list-panel';
import { ScheduleEditDialog } from '../ui/schedule-edit-dialog';
export function SchedulesPage({
  scope,
  branch,
}: {
  scope: ScheduleWorkspace;
  branch: WorkspaceBranch;
}) {
  const locale = useLocale();
  const [week, setWeek] = useState(() =>
    initialScheduleWeek(branch.effective_timezone, new Date()),
  );
  const [cursor, setCursor] = useState<string>();
  const [edit, setEdit] = useState<{ row: ScheduleGrid['items'][number]; day: number }>();
  const list = useScheduleWeek(scope, week, cursor);
  return (
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'shell.schedule_title')}
        description={t(locale, 'shell.schedule_lead')}
      />
      <ScheduleWeekControls
        week={week}
        timezone={branch.effective_timezone}
        fetching={list.isFetching}
        onWeek={(next) => {
          setWeek(next);
          setCursor(undefined);
          setEdit(undefined);
        }}
        onReload={() => {
          setEdit(undefined);
          void list.refetch();
        }}
      />
      <ScheduleListPanel
        list={list}
        cursor={cursor}
        onPage={(next) => {
          setCursor(next);
          setEdit(undefined);
        }}
        onEdit={(row, day) => setEdit({ row, day })}
      />
      {edit && list.data ? (
        <ScheduleEditDialog
          key={`${edit.row.employee_id}:${week}:${edit.day}`}
          scope={scope}
          row={edit.row}
          day={edit.day}
          grid={list.data}
          onClose={() => setEdit(undefined)}
        />
      ) : null}
    </section>
  );
}
