'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  discountLimitFormInput,
  discountLimitInput,
  type DiscountLimitFormValues,
  type DiscountLimitInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { displayDiscountPercentage } from '../model/discount-percentage';

export function DiscountLimitForm({
  limitBps,
  disabled,
  pending,
  onSave,
}: {
  limitBps: number | null;
  disabled: boolean;
  pending: boolean;
  onSave: (input: DiscountLimitInput) => void;
}) {
  const locale = useLocale();
  const [invalidClear, setInvalidClear] = useState(false);
  const form = useForm<DiscountLimitFormValues, unknown, DiscountLimitInput>({
    resolver: zodResolver(discountLimitFormInput),
    defaultValues: { percentage: displayDiscountPercentage(limitBps), reason: '' },
  });
  const clear = () => {
    const result = discountLimitInput.safeParse({
      limit_bps: null,
      reason: form.getValues('reason'),
    });
    setInvalidClear(!result.success);
    if (result.success) onSave(result.data);
  };
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <p>
        {t(locale, 'permissions.discountCurrent')}:{' '}
        {limitBps === null
          ? t(locale, 'permissions.discountUnset')
          : `${displayDiscountPercentage(limitBps)}%`}
      </p>
      <fieldset disabled={disabled || pending} className="flex flex-col gap-3">
        <Label htmlFor="discount-percentage">{t(locale, 'permissions.discountLimit')}</Label>
        <Input id="discount-percentage" inputMode="decimal" {...form.register('percentage')} />
        <Label htmlFor="discount-reason">{t(locale, 'permissions.reason')}</Label>
        <Input id="discount-reason" maxLength={500} {...form.register('reason')} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t(locale, 'permissions.discountSave')}</Button>
          <Button type="button" onClick={clear}>
            {t(locale, 'permissions.discountClear')}
          </Button>
        </div>
      </fieldset>
      {invalidClear || Object.keys(form.formState.errors).length > 0 ? (
        <p role="alert">{t(locale, 'permissions.discountInvalid')}</p>
      ) : null}
    </form>
  );
}
