'use client';

import type { DiscountLimitFormValues } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useId } from 'react';
import { useLocale } from '@/shared/locale/locale-context';

export function DiscountLimitFields({
  disabled,
  onClear,
  label,
}: {
  disabled: boolean;
  onClear: () => void;
  label?: string | undefined;
}) {
  const locale = useLocale();
  const form = useFormContext<DiscountLimitFormValues>();
  const fieldId = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <Label htmlFor={`${fieldId}-percentage`}>
        {label ?? t(locale, 'permissions.discountLimit')}
      </Label>
      <Input
        id={`${fieldId}-percentage`}
        inputMode="decimal"
        aria-invalid={Boolean(form.formState.errors.percentage)}
        className="tabular-nums"
        {...form.register('percentage')}
      />
      <Label htmlFor={`${fieldId}-reason`}>{t(locale, 'permissions.reason')}</Label>
      <Input
        id={`${fieldId}-reason`}
        maxLength={500}
        aria-invalid={Boolean(form.formState.errors.reason)}
        {...form.register('reason')}
      />
      <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
        <Button type="button" variant="outline" onClick={onClear}>
          {t(locale, 'permissions.discountClear')}
        </Button>
        <Button type="submit">{t(locale, 'permissions.discountSave')}</Button>
      </div>
    </fieldset>
  );
}
