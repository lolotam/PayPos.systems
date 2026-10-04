'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  requestEmployeeLeaveInput,
  type RequestEmployeeLeaveInput,
  type WorkspaceBranch,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useForm, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { LeavePeriodFields } from './leave-period-fields';
import { LeaveBranchField } from './leave-branch-field';
interface LeaveRequestFormProps {
  branches: WorkspaceBranch[];
  pending: boolean;
  onSave: (input: RequestEmployeeLeaveInput) => void;
}
function leaveErrorKey(errors: object) {
  for (const error of Object.values(errors as Record<string, { message?: unknown }>)) {
    if (error.message === 'LEAVE_TIME_STEP_INVALID') return 'errors.LEAVE_TIME_STEP_INVALID';
    if (error.message === 'LEAVE_SPAN_TOO_LONG') return 'errors.LEAVE_SPAN_TOO_LONG';
  }
  return 'note' in errors ? 'errors.LEAVE_NOTE_REQUIRED' : 'errors.LEAVE_PERIOD_INVALID';
}
export function LeaveRequestForm({ branches, pending, onSave }: LeaveRequestFormProps) {
  const locale = useLocale();
  const form = useForm<RequestEmployeeLeaveInput>({
    resolver: zodResolver(requestEmployeeLeaveInput),
    shouldUnregister: true,
    defaultValues: {
      kind: 'FULL_DAY',
      type: 'ANNUAL',
      branch_id: branches[0]?.id ?? '',
      from: '',
      to: '',
    },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const errorKey = leaveErrorKey(form.formState.errors);
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <legend className="font-semibold">{t(locale, 'leave.request')}</legend>
        <LeaveBranchField branches={branches} register={form.register} />
        <Label htmlFor="leave-kind">{t(locale, 'leave.kind')}</Label>
        <NativeSelect id="leave-kind" {...form.register('kind')}>
          {(['FULL_DAY', 'PARTIAL'] as const).map((k) => (
            <option key={k} value={k}>
              {t(locale, `leave.${k}`)}
            </option>
          ))}
        </NativeSelect>
        <LeavePeriodFields key={kind} kind={kind} register={form.register} />
        <Label htmlFor="leave-type">{t(locale, 'leave.type')}</Label>
        <NativeSelect id="leave-type" {...form.register('type')}>
          {(['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const).map((type) => (
            <option key={type} value={type}>
              {t(locale, `leave.${type}`)}
            </option>
          ))}
        </NativeSelect>
        <Label htmlFor="leave-note">{t(locale, 'leave.note')}</Label>
        <Input
          id="leave-note"
          maxLength={500}
          {...form.register('note', { setValueAs: (value: string) => value.trim() || undefined })}
        />
        <Button type="submit">{t(locale, 'leave.submit')}</Button>
      </fieldset>
      {Object.keys(form.formState.errors).length > 0 ? (
        <p role="alert">{t(locale, errorKey)}</p>
      ) : null}
    </form>
  );
}
