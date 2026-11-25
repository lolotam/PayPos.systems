'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { createServiceInput, type CreateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { omitRefusedCategory, type ServiceCategoriesQuery } from '../api/use-service-categories';
import { ServiceAttributesFields } from './service-attributes-fields';
import { ServiceBasicsFields } from './service-basics-fields';
import { ServiceRuleFields } from './service-rule-fields';

const CREATE_SERVICE_DEFAULTS: CreateServiceInput = {
  name_en: '',
  name_ar: null,
  price: '0.000',
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  duration_minutes: null,
  category_id: null,
};

export function ServiceForm({
  categoryQuery,
  pending,
  onSave,
}: {
  categoryQuery: ServiceCategoriesQuery;
  pending: boolean;
  onSave: (terms: CreateServiceInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<CreateServiceInput>({
    resolver: zodResolver(createServiceInput),
    defaultValues: CREATE_SERVICE_DEFAULTS,
  });
  const submit = form.handleSubmit((terms) => {
    onSave(omitRefusedCategory(terms, categoryQuery.error));
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-4 text-start">
        <fieldset disabled={pending} className="contents">
          <Card>
            <CardContent className="flex flex-col gap-6">
              <section className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">{t(locale, 'catalogServices.basics')}</h2>
                <div className="grid grid-cols-12 gap-4">
                  <ServiceBasicsFields grid />
                  <ServiceAttributesFields
                    grid
                    categoryQuery={categoryQuery}
                    currentCategoryId={null}
                    currentCategory={null}
                  />
                </div>
              </section>
              <section className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">
                  {t(locale, 'catalogServices.sectionCommission')}
                </h2>
                <ServiceRuleFields grid />
              </section>
            </CardContent>
            <CardFooter>
              <Button type="submit" className="ms-auto">
                {t(locale, 'catalogServices.create')}
              </Button>
            </CardFooter>
          </Card>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'catalogServices.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
