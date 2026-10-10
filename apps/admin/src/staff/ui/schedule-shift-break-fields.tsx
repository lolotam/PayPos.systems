'use client';
import type { SetScheduleInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { newScheduleBreak, scheduleBreakValue } from '../model/schedule-form';

export function ScheduleShiftBreakFields({ index, pending }: { index: number; pending: boolean }) {
  const locale = useLocale();
  const form = useFormContext<SetScheduleInput>();
  const shift = useWatch({ control: form.control, name: `shifts.${index}` });
  const defaults = newScheduleBreak(shift.start, shift.end);
  const setBreak = (value: { break_start: string | null; break_end: string | null }) => {
    form.setValue(`shifts.${index}.break_start`, value.break_start, { shouldDirty: true });
    form.setValue(`shifts.${index}.break_end`, value.break_end, { shouldDirty: true });
  };
  if (shift.break_start == null && shift.break_end == null)
    return (
      <Button
        type="button"
        variant="outline"
        disabled={pending || defaults === null}
        onClick={() => defaults && setBreak(defaults)}
      >
        {t(locale, 'shell.schedule_break_add')}
      </Button>
    );
  return (
    <>
      {(['break_start', 'break_end'] as const).map((key) => (
        <div key={key}>
          <Label htmlFor={`${key}-${index}`}>{t(locale, `shell.schedule_${key}`)}</Label>
          <Controller
            control={form.control}
            name={`shifts.${index}.${key}`}
            render={({ field }) => (
              <Input
                {...field}
                id={`${key}-${index}`}
                type="time"
                disabled={pending}
                value={field.value ?? ''}
                onChange={(event) => field.onChange(scheduleBreakValue(event.target.value))}
              />
            )}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => setBreak({ break_start: null, break_end: null })}
      >
        {t(locale, 'shell.schedule_break_remove')}
      </Button>
    </>
  );
}
