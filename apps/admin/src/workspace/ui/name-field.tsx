'use client';

import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ComponentProps } from 'react';

import { useLocale } from '@/shared/locale/locale-context';

type NameFieldProps = Omit<ComponentProps<'input'>, 'id' | 'aria-invalid'> & {
  id: string;
  label: MessageKey;
  error?: MessageKey | undefined;
};

/** حقل اسم معمم من حقل شركة 077: خطأ الحقل بيلُحم بحقله بالـ aria-describedby لقارئ الشاشة. */
export function NameField({ id, label, error, ...input }: NameFieldProps) {
  const locale = useLocale();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{t(locale, label)}</Label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
      />
      {error ? (
        <p id={errorId} className="text-start text-sm text-destructive">
          {t(locale, error)}
        </p>
      ) : null}
    </div>
  );
}
