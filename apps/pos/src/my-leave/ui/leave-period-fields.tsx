import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Input } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { LeaveFields } from '../model/use-leave-form';
export function LeavePeriodFields({
  form,
  kind,
}: {
  form: UseFormReturn<LeaveFields>;
  kind: LeaveFields['kind'];
}) {
  const locale = useLocale();
  const type = useWatch({ control: form.control, name: 'type' });
  return (
    <>
      {(kind === 'FULL_DAY' ? (['from', 'to'] as const) : (['date'] as const)).map((name) => (
        <label key={name}>
          {t(locale, `leave.${name}`)}
          <Input type="date" required {...form.register(name)} />
        </label>
      ))}
      {kind === 'PARTIAL'
        ? (['start', 'end'] as const).map((name) => (
            <label key={name}>
              {t(locale, `leave.${name}`)}
              <Input type="time" step={900} required {...form.register(name)} />
            </label>
          ))
        : null}
      <label>
        {t(locale, 'leave.note')}
        <Input maxLength={500} required={type === 'OTHER'} {...form.register('note')} />
      </label>
    </>
  );
}
