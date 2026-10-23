'use client';

import { t } from '@pospay/i18n';
import { Badge, Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { StaffColumnsDraft } from '../model/staff-columns-save-body';

const MONTHS_FIELD_ID = 'staff-months-back';

export function StaffMonthsBackField({
  defaultInEffect,
  disabled,
  error,
}: {
  defaultInEffect: boolean;
  disabled: boolean;
  error?: string | undefined;
}) {
  const locale = useLocale();
  const form = useFormContext<StaffColumnsDraft>();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="flex items-center gap-2 text-sm font-semibold">
        {t(locale, 'staffAppColumns.monthsTitle')}
        {defaultInEffect ? (
          <Badge variant="secondary">{t(locale, 'staffAppColumns.defaultInEffect')}</Badge>
        ) : null}
      </legend>
      <Label htmlFor={MONTHS_FIELD_ID}>{t(locale, 'staffAppColumns.monthsLabel')}</Label>
      <Input
        {...form.register('months_back', { valueAsNumber: true })}
        id={MONTHS_FIELD_ID}
        type="number"
        min={1}
        max={12}
        step={1}
        disabled={disabled}
        className="tabular-nums"
      />
      <p className="text-sm text-muted-foreground">{t(locale, 'staffAppColumns.monthsHint')}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
