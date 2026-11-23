'use client';
import type { ComponentProps } from 'react';
import type { CreatePackageTypeInput } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext, type FieldPath, type RegisterOptions } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

type Props = Omit<ComponentProps<typeof Input>, 'name' | 'id'> & {
  id: string;
  name: FieldPath<CreatePackageTypeInput>;
  label: MessageKey;
  errorMessage: MessageKey;
  options?: RegisterOptions<CreatePackageTypeInput>;
  helpId?: string;
  /** فئات عرض العمود على شبكة الـ12 عمودًا؛ بلا شبكة (نموذج التعديل) لا أثر لها. */
  span?: string;
};

export function PackageTypeInput({
  id,
  name,
  label,
  errorMessage,
  options,
  helpId,
  span = '',
  ...input
}: Props) {
  const locale = useLocale();
  const { register, getFieldState, formState } = useFormContext<CreatePackageTypeInput>();
  const { error } = getFieldState(name, formState);
  const description = [helpId, error ? `${id}-error` : undefined].filter(Boolean).join(' ');
  return (
    <div className={`flex min-w-0 flex-col gap-3 ${span}`}>
      <Label htmlFor={id}>{t(locale, label)}</Label>
      <Input
        {...input}
        id={id}
        {...register(name, options)}
        aria-invalid={!!error}
        aria-describedby={description || undefined}
      />
      {error ? <p id={`${id}-error`}>{t(locale, errorMessage)}</p> : null}
    </div>
  );
}
