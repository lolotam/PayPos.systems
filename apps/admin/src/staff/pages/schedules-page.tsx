'use client';
import type { ScheduleGrid, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell, Button } from '@pospay/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useScheduleWeek, type ScheduleWorkspace } from '../api/use-schedules';
import { initialScheduleWeek } from '../model/schedule-form';
import { ScheduleWeekCard } from '../ui/schedule-week-card';
import { ScheduleEditHost } from '../ui/schedule-edit-host';
interface SchedulesPageProps {
  scope: ScheduleWorkspace;
  branch: WorkspaceBranch;
}
export function SchedulesPage({ scope, branch }: SchedulesPageProps) {
  const locale = useLocale();
  const [week, setWeek] = useState(() =>
    initialScheduleWeek(branch.effective_timezone, new Date()),
  );
  const [cursor, setCursor] = useState<string>();
  const [edit, setEdit] = useState<{ row: ScheduleGrid['items'][number]; day: number }>();
  const list = useScheduleWeek(scope, week, cursor);
  const clearEdit = () => setEdit(undefined);
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'shell.schedule_title')}
        description={t(locale, 'shell.schedule_lead')}
        actions={
          <Button asChild variant="outline">
            <Link href="/schedules/settings">{t(locale, 'shell.schedule_settings_title')}</Link>
          </Button>
        }
      />
      <ScheduleWeekCard
        list={list}
        week={week}
        timezone={branch.effective_timezone}
        cursor={cursor}
        onWeek={(next) => {
          setWeek(next);
          setCursor(undefined);
          clearEdit();
        }}
        onReload={() => {
          clearEdit();
          void list.refetch();
        }}
        onPage={(next) => {
          setCursor(next);
          clearEdit();
        }}
        onEdit={(row, day) => setEdit({ row, day })}
      />
      <ScheduleEditHost
        scope={scope}
        week={week}
        edit={edit}
        grid={list.data}
        onClose={clearEdit}
      />
    </PageShell>
  );
}
