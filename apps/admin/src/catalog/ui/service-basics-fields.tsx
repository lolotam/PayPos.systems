'use client';
import type { CreateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

// حقول الاسم والسعر؛ السعر نص KWD بثلاث خانات، مش رقم JS (CLAUDE.md §5).
export function ServiceBasicsFields() {
  const locale = useLocale();
  const { register } = useFormContext<CreateServiceInput>();
  return (
    <>
      <Label htmlFor="service-name-en">{t(locale, 'catalogServices.nameEn')}</Label>
      <Input id="service-name-en" dir="ltr" {...register('name_en')} />
      <Label htmlFor="service-name-ar">{t(locale, 'catalogServices.nameAr')}</Label>
      <Input
        id="service-name-ar"
        dir="rtl"
        {...register('name_ar', {
          setValueAs: (value: unknown) => (typeof value === 'string' ? value.trim() || null : null),
        })}
      />
      <Label htmlFor="service-price">{t(locale, 'catalogServices.price')}</Label>
      <Input
        id="service-price"
        dir="ltr"
        inputMode="decimal"
        placeholder="0.000"
        {...register('price')}
      />
    </>
  );
}
