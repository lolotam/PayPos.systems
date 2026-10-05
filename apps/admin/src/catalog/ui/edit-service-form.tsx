'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateServiceInput, type Service, type UpdateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceBasicsFields } from './service-basics-fields';
import { ServiceRuleFields } from './service-rule-fields';

export function EditServiceForm({
  record,
  pending,
  onSave,
}: {
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
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <ServiceBasicsFields />
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
