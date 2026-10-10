'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setScheduleSettingsInput, type SetScheduleSettingsInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useScheduleSettings, useSetScheduleSettings } from '../api/use-schedule-settings';
import type { ScheduleWorkspace } from '../api/use-schedules';

export function ScheduleSettingsPanel({ scope }: { scope: ScheduleWorkspace }) {
  const locale = useLocale();
  const query = useScheduleSettings(scope);
  const save = useSetScheduleSettings(scope);
  const form = useForm<SetScheduleSettingsInput>({
    resolver: zodResolver(setScheduleSettingsInput),
    values: { max_shifts_per_day: query.data?.max_shifts_per_day ?? 3 },
  });
  if (query.isError) {
    if (
      typeof query.error === 'object' &&
      query.error !== null &&
      'code' in query.error &&
      (query.error.code === 'FORBIDDEN' || query.error.code === 'NOT_FOUND')
    )
      return null;
    return <p role="alert">{envelopeMessage(query.error, locale)}</p>;
  }
  if (!query.data) return null;
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border p-4 text-start"
      onSubmit={form.handleSubmit(async (input) => {
        try {
          await save.mutateAsync(input);
        } catch {
          /* الرسالة الثنائية تأتي من حالة الطلب أدناه. */
        }
      })}
    >
      <h2 className="text-lg font-semibold">{t(locale, 'shell.schedule_settings_title')}</h2>
      {query.data.is_default ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'shell.schedule_settings_default')}
        </p>
      ) : null}
      <Label htmlFor="schedule-max-shifts">{t(locale, 'shell.schedule_settings_limit')}</Label>
      <Input
        id="schedule-max-shifts"
        type="number"
        min={1}
        max={4}
        step={1}
        disabled={save.isPending}
        {...form.register('max_shifts_per_day', { valueAsNumber: true })}
      />
      {form.formState.errors.max_shifts_per_day ? (
        <p role="alert">{t(locale, 'errors.VALIDATION_FAILED')}</p>
      ) : null}
      {save.isError ? <p role="alert">{envelopeMessage(save.error, locale)}</p> : null}
      <Button type="submit" disabled={save.isPending}>
        {t(locale, 'shell.schedule_settings_save')}
      </Button>
    </form>
  );
}
