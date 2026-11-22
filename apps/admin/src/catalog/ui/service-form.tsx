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
    defaultValues: {
      name_en: '',
      name_ar: null,
      price: '0.000',
      commission_rule: { kind: 'FOLLOW_PLAN' },
      counts_toward_threshold: true,
      duration_minutes: null,
      category_id: null,
    },
  });
  const submit = form.handleSubmit((terms) => {
    onSave(omitRefusedCategory(terms, categoryQuery.error));
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-4 text-start">
        <fieldset disabled={pending} className="contents">
          <Card>
            <CardContent className="flex flex-col gap-3">
              <ServiceBasicsFields />
              <ServiceAttributesFields
                categoryQuery={categoryQuery}
                currentCategoryId={null}
                currentCategory={null}
              />
              <ServiceRuleFields />
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
