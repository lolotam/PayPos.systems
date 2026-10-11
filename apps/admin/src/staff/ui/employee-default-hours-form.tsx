'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setEmployeeDefaultShiftsInput, type ScheduleShift, type SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { defaultShiftMinutes } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useId } from 'react';
import { FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { scheduleDayKeys } from '../model/schedule-form';
import { ScheduleShiftBreakFields } from './schedule-shift-break-fields';

export function EmployeeDefaultHoursForm({ shifts, pending, onSave }: {
  shifts: ScheduleShift[]; pending: boolean; onSave: (input: SetEmployeeDefaultShiftsInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<SetEmployeeDefaultShiftsInput>({ resolver: zodResolver(setEmployeeDefaultShiftsInput),
    defaultValues: { shifts } });
  const array = useFieldArray({ control: form.control, name: 'shifts' });
  const prefix = useId();
  return <FormProvider {...form}>
    <form onSubmit={form.handleSubmit((input) => onSave(input))} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        {scheduleDayKeys.map((key, day) => {
          const index = array.fields.findIndex((shift) => shift.day === day);
          return <div key={key} className="flex flex-col gap-2">
            <Label htmlFor={`${prefix}-${key}`}>
              <Input id={`${prefix}-${key}`} type="checkbox" className="size-4" checked={index >= 0}
                onChange={(event) => event.target.checked
                  ? array.append({ day, start: '09:00', end: '17:00', break_start: null, break_end: null })
                  : array.remove(index)} /> {t(locale, `shell.schedule_${key}`)}
            </Label>
            {index >= 0 ? <DefaultDayFields key={array.fields[index]?.id} index={index}
              prefix={`${prefix}-${key}`} pending={pending} /> : null}
          </div>;
        })}
        <Button type="submit">{t(locale, 'employeeDefaultHours.save')}</Button>
        <Button type="button" variant="outline" onClick={() => onSave({ shifts: [] })}>
          {t(locale, 'employeeDefaultHours.clear')}
        </Button>
      </fieldset>
      {form.formState.errors.shifts ? <p role="alert">{t(locale, 'staff.invalid')}</p> : null}
    </form>
  </FormProvider>;
}

function DefaultDayFields({ index, prefix, pending }: { index: number; prefix: string; pending: boolean }) {
  const locale = useLocale();
  const form = useFormContext<SetEmployeeDefaultShiftsInput>();
  const shift = useWatch({ control: form.control, name: `shifts.${index}` });
  const valid = shift && /^\d{2}:\d{2}$/.test(shift.start) && /^\d{2}:\d{2}$/.test(shift.end);
  return <div className="flex flex-wrap items-end gap-2">
    {(['start', 'end'] as const).map((key) => <div key={key}>
      <Label htmlFor={`${prefix}-${key}`}>{t(locale, `shell.schedule_${key}`)}</Label>
      <Input id={`${prefix}-${key}`} type="time" required {...form.register(`shifts.${index}.${key}`)} />
    </div>)}
    <ScheduleShiftBreakFields index={index} pending={pending} idPrefix={prefix} />
    {valid ? <p>{t(locale, 'employeeDefaultHours.duration').replace('{minutes}', String(defaultShiftMinutes(shift)))}</p> : null}
  </div>;
}
