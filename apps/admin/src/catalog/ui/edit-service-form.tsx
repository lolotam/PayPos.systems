'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateServiceInput, type Service, type UpdateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  omitRefusedCategory,
  type ServiceCategoriesQuery,
} from '../api/use-service-categories';
import { ServiceAttributesFields } from './service-attributes-fields';
import { ServiceBasicsFields } from './service-basics-fields';
import { ServiceRuleFields } from './service-rule-fields';

export function EditServiceForm({
  categoryQuery,
  record,
  pending,
  onSave,
}: {
  categoryQuery: ServiceCategoriesQuery;
  record: Service;
  pending: boolean;
  onSave: (terms: UpdateServiceInput) => void;
}) {
  const locale = useLocale();
  const form = useForm<UpdateServiceInput>({
    resolver: zodResolver(updateServiceInput),
    defaultValues: {
      expected_revision: record.revision,
      name_en: record.name_en,
      name_ar: record.name_ar,
      price: record.price,
      commission_rule: record.commission_rule,
      counts_toward_threshold: record.counts_toward_threshold,
      duration_minutes: record.duration_minutes,
      category_id: record.category_id,
    },
  });
  const submit = form.handleSubmit((terms) => {
    onSave(omitRefusedCategory(terms, categoryQuery.error));
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <ServiceBasicsFields />
          <ServiceAttributesFields
            categoryQuery={categoryQuery}
            currentCategoryId={record.category_id}
            currentCategory={record.category}
          />
          <ServiceRuleFields />
          <Button type="submit">{t(locale, 'catalogServices.save')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'catalogServices.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
