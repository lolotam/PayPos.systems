'use client';
import type { ScheduleGrid } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useEffect, useRef } from 'react';
import { FormProvider } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { ScheduleWorkspace } from '../api/use-schedules';
import { useScheduleEditor } from '../model/use-schedule-editor';
import { ScheduleDayForm } from './schedule-day-form';
export function ScheduleEditDialog({
  scope,
  row,
  grid,
  day,
  onClose,
}: {
  scope: ScheduleWorkspace;
  row: ScheduleGrid['items'][number];
  grid: ScheduleGrid;
  day: number;
  onClose: () => void;
}) {
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  const { save, form, past, submit } = useScheduleEditor(scope, row, grid, day, locale, onClose);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="schedule-edit-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!save.isPending) onClose();
      }}
      className="m-auto w-full max-w-lg rounded-xl border border-border bg-card p-6 text-card-foreground backdrop:bg-black/40"
    >
      <FormProvider {...form}>
        <form onSubmit={submit} className="flex flex-col gap-4 text-start">
          <h2 id="schedule-edit-title" className="text-xl font-bold">
            {t(locale, 'shell.schedule_editTitle')}
          </h2>
          <p>
            {row.name_ar && locale === 'ar' ? row.name_ar : row.name_en} · {grid.days[day]}
          </p>
          <p dir="ltr" className="text-sm text-muted-foreground">
            {grid.timezone}
          </p>
          <ScheduleDayForm
            day={day}
            past={past}
            pending={save.isPending}
            error={save.isError ? envelopeMessage(save.error, locale) : null}
            onClose={onClose}
          />
        </form>
      </FormProvider>
    </dialog>
  );
}
