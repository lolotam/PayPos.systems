'use client';

import type { DiscountLimitFormValues } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function DiscountLimitFields({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}) {
  const locale = useLocale();
  const form = useFormContext<DiscountLimitFormValues>();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <Label htmlFor="discount-percentage">{t(locale, 'permissions.discountLimit')}</Label>
      <Input
        id="discount-percentage"
        inputMode="decimal"
        aria-invalid={Boolean(form.formState.errors.percentage)}
        className="tabular-nums"
        {...form.register('percentage')}
      />
      <Label htmlFor="discount-reason">{t(locale, 'permissions.reason')}</Label>
      <Input
        id="discount-reason"
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
