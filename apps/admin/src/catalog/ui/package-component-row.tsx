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
}: {
  index: number;
  services: PackageTypeDetail['components'];
  onRemove: () => void;
}) {
  const locale = useLocale();
  const { control } = useFormContext<CreatePackageTypeInput>();
  const selected = useWatch({ control, name: `components.${index}.service_id` });
  const service = services.find((s) => s.service_id === selected);
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <PackageServiceField index={index} services={services} />
      <PackageTypeInput
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
      {service?.price === '0.000' ? (
        <p role="status">{t(locale, 'catalogPackageTypes.freeWarning')}</p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        onClick={onRemove}
        aria-label={t(locale, 'catalogPackageTypes.removeComponentRow').replace(
          '{row}',
          String(index + 1),
        )}
      >
        {t(locale, 'catalogPackageTypes.removeComponent')}
      </Button>
    </div>
  );
}
