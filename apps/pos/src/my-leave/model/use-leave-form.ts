import { useForm, useWatch } from 'react-hook-form';
import { requestLeaveInput, type RequestLeaveInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
export type LeaveFields = {
  kind: 'FULL_DAY' | 'PARTIAL';
  type: RequestLeaveInput['type'];
  from: string;
  to: string;
  date: string;
  start: string;
  end: string;
  note: string;
};
export function useLeaveForm(submit: (input: RequestLeaveInput) => Promise<void>) {
  const locale = useLocale();
  const form = useForm<LeaveFields>({
    defaultValues: { kind: 'FULL_DAY', type: 'ANNUAL', note: '' },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const onSubmit = form.handleSubmit(async (fields) => {
    const common = {
      type: fields.type,
      ...(fields.note.trim() ? { note: fields.note.trim() } : {}),
    };
    const parsed = requestLeaveInput.safeParse(
      kind === 'FULL_DAY'
        ? { ...common, kind, from: fields.from, to: fields.to }
        : { ...common, kind, date: fields.date, start: fields.start, end: fields.end },
    );
    if (
      !parsed.success ||
      (parsed.data.kind === 'FULL_DAY'
        ? parsed.data.from > parsed.data.to
        : parsed.data.start >= parsed.data.end)
    ) {
      form.setError('root', { message: t(locale, 'myLeave.invalid') });
      return;
    }
    form.clearErrors();
    await submit(parsed.data);
  });
  return { form, kind, onSubmit };
}
