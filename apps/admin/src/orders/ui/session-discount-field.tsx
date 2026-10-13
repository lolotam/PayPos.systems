'use client';
import { discountPercentage, sessionMoney } from '@pospay/contracts';
import { lineNet, parseMoney } from '@pospay/domain';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { normalizeSessionPercent, type SessionDraftForm } from '../model/session-drafts';

export function SessionDiscountField({ index, disabled = false }: { index: number; disabled?: boolean }) {
  const locale = useLocale();
  const { control, getValues, setValue, trigger } = useFormContext<SessionDraftForm>();
  const row = useWatch({ control, name: `lines.${index}` });
  const amount = row.discount_kind === 'AMOUNT', name = amount ? 'discount_amount' : 'discount_percentage';
  const label = t(locale, amount ? 'serviceSessions.discountAmount' : 'serviceSessions.discountPercent');
  const id = `${row.local_id}-discount`;
  useEffect(() => { void trigger(`lines.${index}.${name}`); }, [row.price, index, name, trigger]);
  return <fieldset disabled={disabled} className="grid gap-2 text-start">
    <div className="flex flex-wrap gap-2">
      {(['AMOUNT', 'PERCENT'] as const).map((kind) => <Button key={kind} type="button" variant="outline"
        aria-pressed={row.discount_kind === kind} onClick={() => setValue(`lines.${index}.discount_kind`, kind, { shouldDirty: true })}>
        {t(locale, kind === 'AMOUNT' ? 'serviceSessions.discountAmount' : 'serviceSessions.discountPercent')}
      </Button>)}
    </div>
    <Label htmlFor={id}>{label}</Label>
    <Controller key={name} control={control} name={`lines.${index}.${name}`}
      rules={{ validate: (text) => {
        if (!amount) return discountPercentage.safeParse(normalizeSessionPercent(text)).success || t(locale, 'serviceSessions.invalidDiscount');
        const price = sessionMoney.safeParse(normalizeKwdInput(getValues(`lines.${index}.price`)));
        if (!price.success) return true;
        try {
          lineNet(parseMoney(price.data), parseMoney(sessionMoney.parse(normalizeKwdInput(text)))); return true;
        } catch { return t(locale, 'serviceSessions.invalidDiscount'); }
      } }}
      render={({ field, fieldState }) => <>
        <Input {...field} id={id} dir="ltr" inputMode="decimal" aria-invalid={!!fieldState.error}
          aria-describedby={fieldState.error ? `${id}-error` : undefined}
          onBlur={() => { field.onChange(amount ? normalizeKwdInput(field.value) : normalizeSessionPercent(field.value)); field.onBlur(); }} />
        {fieldState.error ? <p id={`${id}-error`} role="alert">{t(locale, 'serviceSessions.invalidDiscount')}</p> : null}
      </>} />
    {!amount ? <Button type="button" variant="outline" disabled={!discountPercentage.safeParse(normalizeSessionPercent(row.discount_percentage)).success}
      onClick={() => getValues('lines').forEach((_, target) => {
        setValue(`lines.${target}.discount_kind`, 'PERCENT', { shouldDirty: true });
        setValue(`lines.${target}.discount_percentage`, normalizeSessionPercent(row.discount_percentage), { shouldDirty: true, shouldValidate: true });
      })}>{t(locale, 'serviceSessions.samePercent')}</Button> : null}
  </fieldset>;
}
