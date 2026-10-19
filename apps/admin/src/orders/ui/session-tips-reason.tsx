'use client';
import type { RecordSessionTipsInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { tipReasonLength, type SessionTipFormInput } from '../model/session-tip-body';

export function SessionTipsReason({
  form,
  locale,
  locked,
}: {
  form: UseFormReturn<SessionTipFormInput, unknown, RecordSessionTipsInput>;
  locale: Locale;
  locked: boolean;
}) {
  const revision = useWatch({ control: form.control, name: 'expected_revision' });
  const reason = useWatch({ control: form.control, name: 'reason' }) ?? '';
  if ((revision ?? 0) <= 0) return null;
  const field = form.register('reason');
  const invalid = form.formState.errors.reason ? t(locale, 'sessionTips.reasonInvalid') : null;
  return (
    <div className="grid gap-2">
      <Label htmlFor="tip-reason">{t(locale, 'sessionTips.reason')}</Label>
      <Input
        id="tip-reason"
        disabled={locked}
        aria-invalid={!!invalid}
        {...field}
        onChange={(event) => {
          if (!locked) field.onChange(event);
        }}
      />
      <p>
        {t(locale, 'sessionTips.reasonCount').replace('{count}', String(tipReasonLength(reason)))}
      </p>
      {invalid ? <p role="alert">{invalid}</p> : null}
    </div>
  );
}
