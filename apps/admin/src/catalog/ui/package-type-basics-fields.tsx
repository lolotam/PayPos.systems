'use client';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeInput } from './package-type-input';

export function PackageTypeBasicsFields() {
  const locale = useLocale();
  return (
    <>
      <PackageTypeInput
        id="package-name-en"
        name="name_en"
        dir="ltr"
        label="catalogPackageTypes.nameEn"
        errorMessage="errors.PACKAGE_TYPE_NAME_INVALID"
      />
      <PackageTypeInput
        id="package-name-ar"
        name="name_ar"
        dir="rtl"
        label="catalogPackageTypes.nameAr"
        errorMessage="errors.PACKAGE_TYPE_NAME_INVALID"
        options={{
          setValueAs: (value: unknown) => (typeof value === 'string' ? value.trim() || null : null),
        }}
      />
      <PackageTypeInput
        id="package-price"
        name="price"
        dir="ltr"
        inputMode="decimal"
        label="catalogPackageTypes.price"
        errorMessage="errors.PACKAGE_TYPE_PRICE_INVALID"
        options={{ setValueAs: normalizeKwdInput }}
      />
      <PackageTypeInput
        id="package-validity"
        name="validity_days"
        type="number"
        min={1}
        max={730}
        step={1}
        label="catalogPackageTypes.validity"
        errorMessage="errors.PACKAGE_TYPE_VALIDITY_INVALID"
        helpId="package-validity-help"
        options={{ valueAsNumber: true }}
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
