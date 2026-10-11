'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { decideAttendanceChangeInput, type DecideAttendanceChangeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceRequestDecisionForm({
  decision,
  revision,
  pending,
  onSave,
  onClose,
}: {
  decision: 'APPROVED' | 'REJECTED';
  revision: number;
  pending: boolean;
  onSave: (input: DecideAttendanceChangeInput) => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  const form = useForm<DecideAttendanceChangeInput>({
    resolver: zodResolver(decideAttendanceChangeInput),
    defaultValues: { decision, revision },
  });
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <Label htmlFor="request-decision-reason">
          {t(
            locale,
            decision === 'APPROVED'
              ? 'attendanceActions.optionalReason'
              : 'attendanceActions.reason',
          )}
        </Label>
        <Input
          id="request-decision-reason"
          maxLength={500}
          {...form.register('reason', {
            setValueAs: (value: string) =>
              decision === 'APPROVED' && !value.trim() ? undefined : value,
          })}
        />
        {form.formState.errors.reason ? (
          <p role="alert">{t(locale, 'attendanceActions.reasonInvalid')}</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">
            {t(
              locale,
              decision === 'APPROVED' ? 'attendanceActions.approve' : 'attendanceActions.reject',
            )}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t(locale, 'attendanceActions.close')}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
