'use client';
import type { CreatePackageTypeInput, PackageTypeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeInput } from './package-type-input';
import { PackageServiceField } from './package-service-field';

export function PackageComponentRow({
  index,
  services,
  onRemove,
  grid = false,
}: {
  index: number;
  services: PackageTypeDetail['components'];
  onRemove: () => void;
  /** صف الخدمة والجلسات على شبكة الـ12 عمودًا (نموذج الإضافة)؛ لوحة التعديل تبقى متتالية. */
  grid?: boolean;
}) {
  const locale = useLocale();
  const { control } = useFormContext<CreatePackageTypeInput>();
  const selected = useWatch({ control, name: `components.${index}.service_id` });
  const service = services.find((s) => s.service_id === selected);
  // في الشبكة يأتي التحذير بعد زر الإزالة كي لا يدفعه إلى صف ثالث عند md؛ وفي لوحة التعديل يبقى قبله كما كان.
  const freeWarning =
    service?.price === '0.000' ? (
      <p role="status" className="col-span-12">
        {t(locale, 'catalogPackageTypes.freeWarning')}
      </p>
    ) : null;
  return (
    <div
      className={`rounded-xl border p-3 ${grid ? 'grid grid-cols-12 gap-3' : 'flex flex-col gap-2'}`}
    >
      <PackageServiceField
        index={index}
        services={services}
        span={grid ? 'col-span-12 md:col-span-6' : ''}
      />
      <PackageTypeInput
        span={grid ? 'col-span-12 md:col-span-3' : ''}
        id={`package-sessions-${index}`}
        name={`components.${index}.sessions`}
        label="catalogPackageTypes.sessions"
        errorMessage="errors.PACKAGE_TYPE_INVALID_SESSIONS"
        type="number"
        min={1}
        max={365}
        step={1}
        options={{ valueAsNumber: true }}
      />
      {grid ? null : freeWarning}
      <Button
        type="button"
        variant="ghost"
        className={grid ? 'col-span-12 md:col-span-3 md:self-end' : ''}
        onClick={onRemove}
        aria-label={t(locale, 'catalogPackageTypes.removeComponentRow').replace(
          '{row}',
          String(index + 1),
        )}
      >
        {t(locale, 'catalogPackageTypes.removeComponent')}
      </Button>
      {grid ? freeWarning : null}
    </div>
  );
}
