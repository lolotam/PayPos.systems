'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { createPackageTypeInput, type CreatePackageTypeInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageTypeBasicsFields } from './package-type-basics-fields';
import { PackageComponentsFields } from './package-components-fields';

export function PackageTypeForm({
  companyId,
  businessId,
  userId,
  pending,
  onSave,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  pending: boolean;
  onSave: (terms: CreatePackageTypeInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<CreatePackageTypeInput>({
    resolver: zodResolver(createPackageTypeInput),
    defaultValues: {
      name_en: '',
      name_ar: null,
      price: '0.000',
      validity_days: 90,
      components: [{ service_id: '', sessions: 1 }],
    },
  });
  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSave)}
        className="flex flex-col gap-4 text-start"
      >
        <fieldset disabled={pending} className="contents">
          <Card>
            <CardContent className="flex flex-col gap-6">
              <section className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">{t(locale, 'catalogPackageTypes.basics')}</h2>
                <PackageTypeBasicsFields grid />
              </section>
              <PackageComponentsFields
                companyId={companyId}
                businessId={businessId}
                userId={userId}
              />
            </CardContent>
            <CardFooter>
              <Button type="submit" className="ms-auto">
                {t(locale, 'catalogPackageTypes.create')}
              </Button>
            </CardFooter>
          </Card>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'catalogPackageTypes.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
