'use client';
import type { CreatePackageTypeInput } from '@pospay/contracts';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function PackageTypeBasicsFields() {
  const locale = useLocale();
  const { register } = useFormContext<CreatePackageTypeInput>();
  return (
    <>
      <Label htmlFor="package-name-en">{t(locale, 'catalogPackageTypes.nameEn')}</Label>
      <Input id="package-name-en" dir="ltr" {...register('name_en')} />
      <Label htmlFor="package-name-ar">{t(locale, 'catalogPackageTypes.nameAr')}</Label>
      <Input
        id="package-name-ar"
        dir="rtl"
        {...register('name_ar', {
          setValueAs: (value: unknown) => (typeof value === 'string' ? value.trim() || null : null),
        })}
      />
      <Label htmlFor="package-price">{t(locale, 'catalogPackageTypes.price')}</Label>
      <Input
        id="package-price"
        dir="ltr"
        inputMode="decimal"
        {...register('price', { setValueAs: normalizeKwdInput })}
      />
      <Label htmlFor="package-validity">{t(locale, 'catalogPackageTypes.validity')}</Label>
      <Input
        id="package-validity"
        type="number"
        min={1}
        max={730}
        step={1}
        aria-describedby="package-validity-help"
        {...register('validity_days', { valueAsNumber: true })}
      />
      <p id="package-validity-help" className="text-sm text-muted-foreground">
        {t(locale, 'catalogPackageTypes.validityHelp')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t(locale, 'catalogPackageTypes.snapshotHelp')}
      </p>
    </>
  );
}
