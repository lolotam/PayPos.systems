'use client';
import type { CreatePackageTypeInput, PackageTypeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  index: number;
  services: PackageTypeDetail['components'];
  /** فئات عرض العمود على شبكة الصف؛ بلا شبكة (لوحة التعديل) لا أثر لها. */
  span?: string;
};

export function PackageServiceField({ index, services, span = '' }: Props) {
  const locale = useLocale();
  const {
    register,
    formState: { errors },
  } = useFormContext<CreatePackageTypeInput>();
  const error = errors.components?.[index];
  return (
    <div className={`flex min-w-0 flex-col gap-2 ${span}`}>
      <Label htmlFor={`package-service-${index}`}>{t(locale, 'catalogPackageTypes.service')}</Label>
      <select
        id={`package-service-${index}`}
        aria-invalid={!!error?.service_id}
        aria-describedby={error?.service_id ? `package-service-${index}-error` : undefined}
        className="rounded-xl border bg-background p-2 text-start"
        {...register(`components.${index}.service_id`)}
      >
        <option value="">{t(locale, 'catalogPackageTypes.selectService')}</option>
        {services.map((s) => (
          <option key={s.service_id} value={s.service_id}>
            {locale === 'ar' ? (s.name_ar ?? s.name_en) : s.name_en} ({s.price})
          </option>
        ))}
      </select>
      {error?.service_id ? (
        <p id={`package-service-${index}-error`}>
          {t(
            locale,
            error.service_id.message === 'PACKAGE_TYPE_DUPLICATE_SERVICE'
              ? 'errors.PACKAGE_TYPE_DUPLICATE_SERVICE'
              : 'catalogPackageTypes.selectService',
          )}
        </p>
      ) : null}
    </div>
  );
}
