'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { correctAttendanceInput, type CorrectAttendanceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { AttendanceCorrectionFields } from './attendance-correction-fields';
import type { AttendanceSession } from '../model/attendance-action-display';
export function AttendanceCorrectionForm({
  row,
  timezone,
  pending,
  onSave,
  onClose,
}: {
  row: AttendanceSession;
  timezone: string;
  pending: boolean;
  onSave: (input: CorrectAttendanceInput) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const form = useForm<CorrectAttendanceInput>({
    resolver: zodResolver(correctAttendanceInput),
    defaultValues: { revision: row.revision, reason: '' },
  });
  return (
    <form
      onSubmit={form.handleSubmit((input) => {
        if (
          (!input.clock_in || Date.parse(input.clock_in) === Date.parse(row.clock_in)) &&
          (!input.clock_out || Date.parse(input.clock_out) === Date.parse(row.clock_out ?? ''))
        ) {
          form.setError('root', { type: 'validate' });
          return;
        }
        onSave(input);
      })}
      className="flex flex-col gap-3"
    >
      <p>{t(locale, 'attendanceActions.correctionHint')}</p>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'attendanceActions.timezone')}: <bdi>{timezone}</bdi>
      </p>
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <AttendanceCorrectionFields row={row} timezone={timezone} register={form.register} />
        <Label htmlFor="correction-reason">{t(locale, 'attendanceActions.reason')}</Label>
        <Input id="correction-reason" maxLength={500} {...form.register('reason')} />
        <div className="flex gap-2">
          <Button type="submit">{t(locale, 'attendanceActions.save')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'attendanceActions.close')}
          </Button>
        </div>
      </fieldset>
      {Object.keys(form.formState.errors).length ? (
        <p role="alert">
          {t(
            locale,
            form.formState.errors.reason
              ? 'attendanceActions.reasonInvalid'
              : 'attendanceActions.timeInvalid',
          )}
        </p>
      ) : null}
    </form>
  );
}
