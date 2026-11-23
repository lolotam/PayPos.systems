'use client';

import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ComponentProps } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

type CompanyNameFieldProps = Omit<ComponentProps<'input'>, 'id' | 'aria-invalid'> & {
  id: string;
  label: MessageKey;
  error?: MessageKey | undefined;
};

export function CompanyNameField({ id, label, error, ...input }: CompanyNameFieldProps) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{t(locale, label)}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} {...input} />
      {error ? <p className="text-start text-sm text-destructive">{t(locale, error)}</p> : null}
    </div>
  );
}
