'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { setEmployeeDefaultShiftsInput, type ScheduleShift, type SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { scheduleDayKeys } from '../model/schedule-form';
import { EmployeeDefaultDayFields } from './employee-default-day-fields';

export function EmployeeDefaultHoursBulkFields({ id, shifts, pending, onApply }: {
  id: string; shifts: ScheduleShift[]; pending: boolean; onApply: (shifts: ScheduleShift[]) => void;
}) {
  const locale = useLocale();
  const sources = shifts.filter((shift) => shift.start && shift.end);
  const [source, setSource] = useState(sources[0] ? String(sources[0].day) : '');
  const [daysOff, setDaysOff] = useState(() => scheduleDayKeys.map((_, day) => !shifts.some((shift) => shift.day === day)));
  const form = useForm<SetEmployeeDefaultShiftsInput>({ resolver: zodResolver(setEmployeeDefaultShiftsInput),
    defaultValues: { shifts: [sources[0] ?? { day: 0, start: '', end: '', break_start: null, break_end: null }] } });
  const apply = form.handleSubmit(({ shifts: [range] }) => {
    if (range) onApply(scheduleDayKeys.flatMap((_, day) => daysOff[day] ? [] : [{ ...range, day }]));
  });
  return <FormProvider {...form}>
    <fieldset id={id} className="flex flex-col gap-3 rounded-card border border-border p-4">
      <legend>{t(locale, 'employeeDefaultHours.hoursToCopy')}</legend>
      <p className="text-sm text-muted-foreground">{t(locale, 'employeeDefaultHours.sameHoursHint')}</p>
      <div>
        <Label htmlFor={`${id}-source`}>{t(locale, 'employeeDefaultHours.sourceDay')}</Label>
        <NativeSelect id={`${id}-source`} value={source} onChange={(event) => {
          const value = event.target.value;
          setSource(value);
          const selected = sources.find((shift) => String(shift.day) === value);
          if (selected) form.reset({ shifts: [{ ...selected }] });
        }}>
          <option value="">{t(locale, 'employeeDefaultHours.customHours')}</option>
          {sources.map((shift) => <option key={shift.day} value={shift.day}>
            {t(locale, `shell.schedule_${scheduleDayKeys[shift.day] ?? 'sat'}`)}
          </option>)}
        </NativeSelect>
      </div>
      <EmployeeDefaultDayFields index={0} prefix={id} pending={pending} required={false} />
      <fieldset className="flex flex-wrap gap-2">
        <legend>{t(locale, 'employeeDefaultHours.daysOff')}</legend>
        {scheduleDayKeys.map((key, day) => <Label key={key} htmlFor={`${id}-off-${key}`} className="flex items-center gap-2">
          <Input id={`${id}-off-${key}`} type="checkbox" className="size-4" checked={daysOff[day] ?? false}
            onChange={(event) => setDaysOff((current) => current.map((off, index) => index === day ? event.target.checked : off))} />
          {t(locale, `shell.schedule_${key}`)}
        </Label>)}
      </fieldset>
      <Button type="button" variant="outline" onClick={() => void apply()}>{t(locale, 'employeeDefaultHours.applyHours')}</Button>
      {form.formState.errors.shifts ? <p role="alert">{t(locale, 'staff.invalid')}</p> : null}
    </fieldset>
  </FormProvider>;
}
