'use client';
import type { CreatePackageTypeInput, PackageTypeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageServices } from '../api/use-package-services';
import { PackageComponentRow } from './package-component-row';

type Props = {
  companyId: string;
  businessId: string;
  userId: string;
  initial?: PackageTypeDetail['components'];
};

export function PackageComponentsFields({ companyId, businessId, userId, initial = [] }: Props) {
  const locale = useLocale();
  const {
    control,
    formState: { errors },
  } = useFormContext<CreatePackageTypeInput>();
  const invalidCount = !!(errors.components?.root ?? errors.components?.message);
  const { fields, append, remove } = useFieldArray({ control, name: 'components' });
  const query = usePackageServices(companyId, businessId, userId);
  const services = serviceOptions(initial, query.data);
  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-invalid={invalidCount}
      aria-describedby={invalidCount ? 'package-components-error' : undefined}
    >
      <legend>{t(locale, 'catalogPackageTypes.components')}</legend>
      {invalidCount ? (
        <p id="package-components-error">{t(locale, 'errors.PACKAGE_TYPE_INVALID_COMPONENTS')}</p>
      ) : null}
      {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)}</p> : null}
      {fields.map((field, index) => (
        <PackageComponentRow
          key={field.id}
          index={index}
          services={services}
          onRemove={() => remove(index)}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={fields.length >= 20}
        onClick={() => append({ service_id: '', sessions: 1 })}
      >
        {t(locale, 'catalogPackageTypes.addComponent')}
      </Button>
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t(locale, 'catalogPackageTypes.nextServices')}
        </Button>
      ) : null}
    </fieldset>
  );
}

function serviceOptions(
  initial: PackageTypeDetail['components'],
  data: ReturnType<typeof usePackageServices>['data'],
) {
  const options = new Map(initial.map((s) => [s.service_id, s]));
  for (const page of data?.pages ?? [])
    for (const s of page.items)
      options.set(s.id, {
        service_id: s.id,
        sessions: 1,
        name_en: s.name_en,
        name_ar: s.name_ar,
        price: s.price,
      });
  return [...options.values()];
}
