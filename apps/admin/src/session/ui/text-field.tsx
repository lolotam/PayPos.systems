'use client';

import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ComponentProps } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

type TextFieldProps = Omit<ComponentProps<'input'>, 'id' | 'aria-invalid'> & {
  id: string;
  label: string;
  error?: MessageKey | undefined;
};

export function TextField({ id, label, error, ...input }: TextFieldProps) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} {...input} />
      {error ? <p className="text-start text-sm text-destructive">{t(locale, error)}</p> : null}
    </div>
  );
}
