'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { createServiceInput, type CreateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceBasicsFields } from './service-basics-fields';
import { ServiceRuleFields } from './service-rule-fields';

export function ServiceForm({
  pending,
  onSave,
}: {
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
    },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <ServiceBasicsFields />
          <ServiceRuleFields />
          <Button type="submit">{t(locale, 'catalogServices.create')}</Button>
        </fieldset>
        {Object.keys(form.formState.errors).length ? (
          <p role="alert">{t(locale, 'catalogServices.invalid')}</p>
        ) : null}
      </form>
    </FormProvider>
  );
}
