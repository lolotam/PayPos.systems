'use client';
import type { SetScheduleInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ScheduleShiftFields } from './schedule-shift-fields';
export function ScheduleDayForm({
  day,
  past,
  pending,
  error,
  onClose,
}: {
  day: number;
  past: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const locale = useLocale();
  const form = useFormContext<SetScheduleInput>();
  return (
    <>
      <p className="text-sm text-muted-foreground">{t(locale, 'shell.schedule_overnight')}</p>
      <ScheduleShiftFields day={day} pending={pending} />
      <Label htmlFor="schedule-reason">{t(locale, 'shell.schedule_reason')}</Label>
      <Input
        id="schedule-reason"
        required={past}
        maxLength={500}
        disabled={pending}
        {...form.register('reason', { setValueAs: (value: string) => value.trim() || undefined })}
      />
      {past ? <p>{t(locale, 'shell.schedule_pastReason')}</p> : null}
      {form.formState.errors.reason ? (
        <p role="alert">{form.formState.errors.reason.message}</p>
      ) : null}
      {form.formState.errors.shifts ? <p role="alert">{t(locale, 'staff.invalid')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t(locale, 'shell.schedule_save')}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          {t(locale, 'shell.schedule_close')}
        </Button>
      </div>
    </>
  );
}
