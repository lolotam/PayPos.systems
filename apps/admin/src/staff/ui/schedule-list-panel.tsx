'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ScheduleGridTable } from './schedule-grid';
export function ScheduleListPanel({
  list,
  cursor,
  onPage,
  onEdit,
}: {
  list: UseQueryResult<ScheduleGrid>;
  cursor: string | undefined;
  onPage: (cursor: string | undefined) => void;
  onEdit: (row: ScheduleGrid['items'][number], day: number) => void;
}) {
  const locale = useLocale();
  return (
    <>
      {list.isPending ? (
        <EmptyState icon={<LoaderCircle />} role="status" title={t(locale, 'admin.loading')} />
      ) : null}
      {list.isError ? (
        <EmptyState
          icon={<CircleAlert />}
          role="alert"
          tone="danger"
          title={envelopeMessage(list.error, locale)}
        />
      ) : null}
      {list.data && !list.isError ? <ScheduleGridTable data={list.data} onEdit={onEdit} /> : null}
      {list.data?.items.length === 0 ? <p>{t(locale, 'shell.schedule_empty')}</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!cursor || list.isFetching}
          onClick={() => onPage(undefined)}
        >
          {t(locale, 'shell.schedule_previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!list.data?.next_cursor || list.isFetching || list.isError}
          onClick={() => onPage(list.data?.next_cursor ?? undefined)}
        >
          {t(locale, 'shell.schedule_next')}
        </Button>
      </div>
    </>
  );
}
