'use client';
import type { RequestEmployeeLeaveInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function LeavePeriodFields({
  kind,
  register,
}: {
  kind: 'FULL_DAY' | 'PARTIAL';
  register: UseFormRegister<RequestEmployeeLeaveInput>;
}) {
  const locale = useLocale();
  return (
    <>
      {kind === 'FULL_DAY' ? (
        <>
          <Label htmlFor="leave-from">{t(locale, 'leave.from')}</Label>
          <Input id="leave-from" type="date" {...register('from')} />
          <Label htmlFor="leave-to">{t(locale, 'leave.to')}</Label>
          <Input id="leave-to" type="date" {...register('to')} />
        </>
      ) : (
        <>
          <Label htmlFor="leave-date">{t(locale, 'leave.date')}</Label>
          <Input id="leave-date" type="date" {...register('date')} />
          <Label htmlFor="leave-start">{t(locale, 'leave.start')}</Label>
          <Input id="leave-start" type="time" step={900} {...register('start')} />
          <Label htmlFor="leave-end">{t(locale, 'leave.end')}</Label>
          <Input id="leave-end" type="time" step={900} {...register('end')} />
        </>
      )}
    </>
  );
}
