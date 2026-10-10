'use client';
import { useContext } from 'react';
import { ScheduleLimitContext, newScheduleShift } from '../model/schedule-form';
import type { SetScheduleInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function ScheduleShiftFields({ day, pending }: { day: number; pending: boolean }) {
  const locale = useLocale();
  const maxShiftsPerDay = useContext(ScheduleLimitContext);
  const form = useFormContext<SetScheduleInput>();
  const array = useFieldArray({ control: form.control, name: 'shifts' });
  const fields = array.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.day === day);
  return (
    <>
      {fields.map(({ field, index }) => (
        <fieldset key={field.id} disabled={pending} className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`start-${index}`}>{t(locale, 'shell.schedule_start')}</Label>
            <Input
              id={`start-${index}`}
              type="time"
              required
              {...form.register(`shifts.${index}.start`)}
            />
          </div>
          <div>
            <Label htmlFor={`end-${index}`}>{t(locale, 'shell.schedule_end')}</Label>
            <Input
              id={`end-${index}`}
              type="time"
              required
              {...form.register(`shifts.${index}.end`)}
            />
          </div>
          <Button type="button" variant="outline" onClick={() => array.remove(index)}>
            {t(locale, 'shell.schedule_remove')}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={fields.length >= maxShiftsPerDay || pending}
        onClick={() => array.append(newScheduleShift(day, fields.length))}
      >
        {t(locale, 'shell.schedule_add')}
      </Button>
    </>
  );
}
