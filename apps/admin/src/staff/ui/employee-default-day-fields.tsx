'use client';
import type { SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { defaultShiftMinutes } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ScheduleShiftBreakFields } from './schedule-shift-break-fields';

export function EmployeeDefaultDayFields({ index, prefix, pending, required = true }: {
  index: number; prefix: string; pending: boolean; required?: boolean;
}) {
  const locale = useLocale();
  const form = useFormContext<SetEmployeeDefaultShiftsInput>();
  const shift = useWatch({ control: form.control, name: `shifts.${index}` });
  const valid = shift && /^\d{2}:\d{2}$/.test(shift.start) && /^\d{2}:\d{2}$/.test(shift.end);
  return <div className="flex flex-wrap items-end gap-2">
    {(['start', 'end'] as const).map((key) => <div key={key}>
      <Label htmlFor={`${prefix}-${key}`}>{t(locale, `shell.schedule_${key}`)}</Label>
      <Input id={`${prefix}-${key}`} type="time" required={required} {...form.register(`shifts.${index}.${key}`)} />
    </div>)}
    <ScheduleShiftBreakFields index={index} pending={pending} idPrefix={prefix} />
    {valid ? <p>{t(locale, 'employeeDefaultHours.duration').replace('{minutes}', String(defaultShiftMinutes(shift)))}</p> : null}
  </div>;
}
