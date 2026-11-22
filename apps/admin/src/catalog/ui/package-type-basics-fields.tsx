'use client';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeInput } from './package-type-input';

// الشبكة اختيارية: نموذج الإضافة يضعها على 12 عمودًا، ونموذج التعديل يبقى متتاليًا كما هو.
const NAME_SPAN = 'col-span-12 md:col-span-6';
const SHORT_SPAN = 'col-span-12 md:col-span-4';

export function PackageTypeBasicsFields({ grid = false }: { grid?: boolean }) {
  const locale = useLocale();
  return (
    <div className={grid ? 'grid grid-cols-12 gap-4' : 'contents'}>
      <PackageTypeInput
        span={NAME_SPAN}
        id="package-name-en"
        name="name_en"
        dir="ltr"
        label="catalogPackageTypes.nameEn"
        errorMessage="errors.PACKAGE_TYPE_NAME_INVALID"
      />
      <PackageTypeInput
        span={NAME_SPAN}
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
        span={SHORT_SPAN}
        id="package-price"
        name="price"
        dir="ltr"
        inputMode="decimal"
        label="catalogPackageTypes.price"
        errorMessage="errors.PACKAGE_TYPE_PRICE_INVALID"
        options={{ setValueAs: normalizeKwdInput }}
      />
      <PackageTypeInput
        span={SHORT_SPAN}
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
      <p id="package-validity-help" className="col-span-12 text-sm text-muted-foreground">
        {t(locale, 'catalogPackageTypes.validityHelp')}
      </p>
      <p className="col-span-12 text-sm text-muted-foreground">
        {t(locale, 'catalogPackageTypes.snapshotHelp')}
      </p>
    </div>
  );
}
