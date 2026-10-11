'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { attendanceChangeRequestInput, type AttendanceChangeRequestInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceBoardScope } from '../api/use-attendance-board';
import { attendanceUtc } from '../model/attendance-local-time';
import { AttendanceEmployeePicker } from './attendance-employee-picker';
type Props = {
  scope: AttendanceBoardScope;
  timezone: string;
  pending: boolean;
  onSave: (input: AttendanceChangeRequestInput) => void;
  onClose: () => void;
};
export function AttendanceManualForm({ scope, timezone, pending, onSave, onClose }: Props) {
  const locale = useLocale();
  const form = useForm<AttendanceChangeRequestInput>({
    resolver: zodResolver(attendanceChangeRequestInput),
    defaultValues: { kind: 'ADD_SESSION', employee_id: '', branch_id: scope.branchId, reason: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3">
      <p>{t(locale, 'attendanceActions.manualHint')}</p>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'attendanceActions.timezone')}: <bdi>{timezone}</bdi>
      </p>
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <AttendanceEmployeePicker
          scope={scope}
          register={form.register}
          employeeId={form.watch('employee_id')}
          onSearchChanged={() => form.setValue('employee_id', '', { shouldValidate: false })}
        />
        {(['clock_in', 'clock_out'] as const).map((field) => (
          <div key={field} className="grid gap-1">
            <Label htmlFor={`manual-${field}`}>
              {t(
                locale,
                field === 'clock_in' ? 'attendanceBoard.clockIn' : 'attendanceBoard.clockOut',
              )}
            </Label>
            <Input
              id={`manual-${field}`}
              type="datetime-local"
              step="1"
              {...form.register(field, {
                setValueAs: (value: string) => attendanceUtc(value, timezone),
              })}
            />
          </div>
        ))}
        <Label htmlFor="manual-reason">{t(locale, 'attendanceActions.reason')}</Label>
        <Input id="manual-reason" maxLength={500} {...form.register('reason')} />
        <div className="flex gap-2">
          <Button type="submit">{t(locale, 'attendanceActions.save')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'attendanceActions.close')}
          </Button>
        </div>
      </fieldset>
      {Object.keys(form.formState.errors).length ? (
        <p role="alert">{t(locale, 'attendanceActions.manualInvalid')}</p>
      ) : null}
    </form>
  );
}
