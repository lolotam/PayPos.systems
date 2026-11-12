'use client';
import type { ExtendPackageInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useId } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { nextDay } from '../model/extend-package-values';

function validationMessage(
  locale: Locale,
  message: string | undefined,
  fallback: 'dateRequired' | 'reasonRequired',
): string {
  const key = message === 'dateNotLater' || message === 'reasonTooLong' ? message : fallback;
  return t(locale, `packageExtension.${key}`);
}

export function ExtendPackageForm({
  form,
  currentExpiresOn,
  disabled,
}: {
  form: UseFormReturn<ExtendPackageInput>;
  currentExpiresOn: string;
  disabled: boolean;
}) {
  const locale = useLocale();
  const prefix = useId();
  const dateError = form.formState.errors.new_expires_on?.message;
  const reasonError = form.formState.errors.reason?.message;
  return (
    <div className="grid gap-3">
      <p>
        {t(locale, 'packageExtension.currentExpiry').replace('{date}', '')}
        <bdi dir="ltr">{currentExpiresOn}</bdi>
      </p>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-date`}>{t(locale, 'packageExtension.newDate')}</Label>
        <Input
          id={`${prefix}-date`}
          type="date"
          dir="ltr"
          min={nextDay(currentExpiresOn)}
          disabled={disabled}
          aria-invalid={dateError !== undefined}
          aria-describedby={dateError ? `${prefix}-date-error` : undefined}
          {...form.register('new_expires_on')}
        />
        {dateError !== undefined ? (
          <p id={`${prefix}-date-error`} role="alert">
            {validationMessage(locale, dateError, 'dateRequired')}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${prefix}-reason`}>{t(locale, 'packageExtension.reason')}</Label>
        <textarea
          id={`${prefix}-reason`}
          rows={4}
          disabled={disabled}
          aria-invalid={reasonError !== undefined}
          aria-describedby={`${prefix}-reason-hint${reasonError ? ` ${prefix}-reason-error` : ''}`}
          className="flex min-h-24 w-full rounded-interactive border border-input bg-card ps-3 pe-3 py-2 text-start text-base text-card-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
          {...form.register('reason')}
        />
        <p id={`${prefix}-reason-hint`} className="text-sm text-muted-foreground">
          {t(locale, 'packageExtension.reasonHint')}
        </p>
        {reasonError !== undefined ? (
          <p id={`${prefix}-reason-error`} role="alert">
            {validationMessage(locale, reasonError, 'reasonRequired')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
