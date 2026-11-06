import { useLeaveForm } from '../model/use-leave-form';
import { LeavePeriodFields } from './leave-period-fields';
import { type RequestLeaveInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function LeaveForm({
  busy,
  submit,
}: {
  busy: boolean;
  submit(input: RequestLeaveInput): Promise<void>;
}) {
  const locale = useLocale();
  const { form, kind, onSubmit } = useLeaveForm(submit);
  return (
    <form
      onChange={() => form.clearErrors('root')}
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="grid gap-3"
    >
      <fieldset disabled={busy} className="grid gap-3">
        <legend>{t(locale, 'leave.createOwn')}</legend>
        <label>
          {t(locale, 'leave.kind')}
          <select {...form.register('kind')}>
            {(['FULL_DAY', 'PARTIAL'] as const).map((value) => (
              <option key={value} value={value}>
                {t(locale, `leave.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t(locale, 'leave.type')}
          <select {...form.register('type')}>
            {(['ANNUAL', 'SICK', 'UNPAID', 'OTHER'] as const).map((value) => (
              <option key={value} value={value}>
                {t(locale, `leave.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <LeavePeriodFields form={form} kind={kind} />
        {form.formState.errors.root ? (
          <p role="alert">{form.formState.errors.root.message}</p>
        ) : null}
        <Button type="submit">{t(locale, 'leave.submit')}</Button>
      </fieldset>
    </form>
  );
}
