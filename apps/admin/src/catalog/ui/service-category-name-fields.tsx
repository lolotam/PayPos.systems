'use client';
import type { CreateServiceCategoryInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext, type FieldError } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

function nameError(error: FieldError | undefined, locale: Locale, id: string) {
  if (!error) return null;
  const key =
    error.type === 'too_big'
      ? 'catalogServiceCategories.nameTooLong'
      : error.type === 'custom'
        ? 'catalogServiceCategories.nameInvalid'
        : 'catalogServiceCategories.nameRequired';
  return (
    <p id={id} role="alert">
      {t(locale, key)}
    </p>
  );
}

export function ServiceCategoryNameFields({ mode }: { mode: 'create' | 'rename' }) {
  const locale = useLocale();
  const { register, formState } = useFormContext<CreateServiceCategoryInput>();
  const errorId = `${mode}-category-name-error`;
  return (
    <>
      <Label htmlFor={`${mode}-category-name-en`}>
        {t(locale, 'catalogServiceCategories.nameEn')}
      </Label>
      <Input
        id={`${mode}-category-name-en`}
        dir="ltr"
        aria-invalid={!!formState.errors.name_en}
        aria-required="true"
        aria-describedby={formState.errors.name_en ? `${errorId}-en` : undefined}
        {...register('name_en')}
      />
      {nameError(formState.errors.name_en, locale, `${errorId}-en`)}
      <Label htmlFor={`${mode}-category-name-ar`}>
        {t(locale, 'catalogServiceCategories.nameAr')}
      </Label>
      <Input
        id={`${mode}-category-name-ar`}
        dir="rtl"
        aria-invalid={!!formState.errors.name_ar}
        aria-required="true"
        aria-describedby={formState.errors.name_ar ? `${errorId}-ar` : undefined}
        {...register('name_ar')}
      />
      {nameError(formState.errors.name_ar, locale, `${errorId}-ar`)}
    </>
  );
}
