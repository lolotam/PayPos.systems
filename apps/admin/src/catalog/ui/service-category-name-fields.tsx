'use client';
import type { CreateServiceCategoryInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

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
        aria-describedby={formState.errors.name_en ? errorId : undefined}
        {...register('name_en')}
      />
      <Label htmlFor={`${mode}-category-name-ar`}>
        {t(locale, 'catalogServiceCategories.nameAr')}
      </Label>
      <Input
        id={`${mode}-category-name-ar`}
        dir="rtl"
        aria-invalid={!!formState.errors.name_ar}
        aria-required="true"
        aria-describedby={formState.errors.name_ar ? errorId : undefined}
        {...register('name_ar')}
      />
      {Object.keys(formState.errors).length ? (
        <p id={errorId} role="alert">
          {t(locale, 'catalogServiceCategories.nameRequired')}
        </p>
      ) : null}
    </>
  );
}
