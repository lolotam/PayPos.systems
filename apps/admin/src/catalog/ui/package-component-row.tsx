'use client';
import type { CreatePackageTypeInput, PackageTypeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useFormContext, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

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
  const { register, control } = useFormContext<CreatePackageTypeInput>();
  const selected = useWatch({ control, name: `components.${index}.service_id` });
  const service = services.find((s) => s.service_id === selected);
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <Label htmlFor={`package-service-${index}`}>{t(locale, 'catalogPackageTypes.service')}</Label>
      <select
        id={`package-service-${index}`}
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
      <Label htmlFor={`package-sessions-${index}`}>
        {t(locale, 'catalogPackageTypes.sessions')}
      </Label>
      <Input
        id={`package-sessions-${index}`}
        type="number"
        min={1}
        max={365}
        step={1}
        {...register(`components.${index}.sessions`, { valueAsNumber: true })}
      />
      {service?.price === '0.000' ? (
        <p role="status">{t(locale, 'catalogPackageTypes.freeWarning')}</p>
      ) : null}
      <Button type="button" variant="ghost" onClick={onRemove}>
        {t(locale, 'catalogPackageTypes.removeComponent')}
      </Button>
    </div>
  );
}
