'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  discountLimitFormInput,
  discountLimitInput,
  type DiscountLimitFormValues,
  type DiscountLimitInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { displayDiscountPercentage } from '../model/discount-percentage';
import { DiscountLimitFields } from './discount-limit-fields';

export function DiscountLimitForm({
  limitBps,
  disabled,
  pending,
  onSave,
  label,
  unsetText,
}: {
  limitBps: number | null;
  disabled: boolean;
  pending: boolean;
  onSave: (input: DiscountLimitInput) => void;
  label?: string | undefined;
  unsetText?: string | undefined;
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
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(onSave)}
        className="flex flex-col gap-2 rounded-card border border-border bg-secondary/30 p-4 text-start"
      >
        <p className="mb-2 text-sm font-semibold">
          {t(locale, 'permissions.discountCurrent')}:{' '}
          {limitBps === null ? (
            (unsetText ?? t(locale, 'permissions.discountUnset'))
          ) : (
            <span className="tabular-nums">{displayDiscountPercentage(limitBps)}%</span>
          )}
        </p>
        <DiscountLimitFields disabled={disabled || pending} onClear={clear} label={label} />
        {invalidClear || Object.keys(form.formState.errors).length > 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {t(locale, 'permissions.discountInvalid')}
          </p>
        ) : null}
      </form>
    </FormProvider>
  );
}
