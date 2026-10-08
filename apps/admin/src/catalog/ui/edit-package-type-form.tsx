'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  updatePackageTypeInput,
  type PackageTypeDetail,
  type UpdatePackageTypeInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeBasicsFields } from './package-type-basics-fields';
import { PackageComponentsFields } from './package-components-fields';

export function EditPackageTypeForm({
  record,
  companyId,
  businessId,
  userId,
  pending,
  onSave,
}: {
  record: PackageTypeDetail;
  companyId: string;
  businessId: string;
  userId: string;
  pending: boolean;
  onSave: (terms: UpdatePackageTypeInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<UpdatePackageTypeInput>({
    resolver: zodResolver(updatePackageTypeInput),
    defaultValues: {
      expected_revision: record.revision,
      name_en: record.name_en,
      name_ar: record.name_ar,
      price: record.price,
      validity_days: record.validity_days,
      components: record.components.map(({ service_id, sessions }) => ({ service_id, sessions })),
    },
  });
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSave)}
        className="flex flex-col gap-3 text-start"
      >
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <PackageTypeBasicsFields />
          <PackageComponentsFields
            companyId={companyId}
            businessId={businessId}
            userId={userId}
            initial={record.components}
          />
          <Button type="submit">{t(locale, 'catalogPackageTypes.save')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'catalogPackageTypes.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
