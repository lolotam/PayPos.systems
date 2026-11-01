'use client';
import type { CreateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

function durationFromInput(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : Number(text);
}

export function ServiceDurationField() {
  const locale = useLocale();
  const {
    register,
    formState: { errors },
  } = useFormContext<CreateServiceInput>();
  return (
    <>
      <Label htmlFor="service-duration">{t(locale, 'catalogServices.duration')}</Label>
      <Input
        id="service-duration"
        dir="ltr"
        inputMode="numeric"
        aria-invalid={!!errors.duration_minutes}
        aria-describedby={errors.duration_minutes ? 'service-duration-error' : undefined}
        {...register('duration_minutes', { setValueAs: durationFromInput })}
      />
      {errors.duration_minutes ? (
        <p id="service-duration-error">{t(locale, 'catalogServices.durationInvalid')}</p>
      ) : null}
    </>
  );
}
