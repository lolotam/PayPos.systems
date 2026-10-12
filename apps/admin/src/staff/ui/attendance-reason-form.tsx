'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  attendanceExceptionDecisionInput,
  type AttendanceExceptionDecisionInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useId } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceReasonForm({
  revision,
  pending,
  onSave,
  onClose,
}: {
  revision: number;
  pending: boolean;
  onSave: (input: AttendanceExceptionDecisionInput) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const id = useId();
  const form = useForm<AttendanceExceptionDecisionInput>({
    resolver: zodResolver(attendanceExceptionDecisionInput),
    defaultValues: { revision, reason: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <Label htmlFor={id}>{t(locale, 'attendanceActions.reason')}</Label>
        <Input
          id={id}
          maxLength={500}
          {...form.register('reason')}
          aria-invalid={Boolean(form.formState.errors.reason)}
        />
        {form.formState.errors.reason ? (
          <p role="alert">{t(locale, 'attendanceActions.reasonInvalid')}</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">{t(locale, 'attendanceActions.save')}</Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'attendanceActions.close')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
