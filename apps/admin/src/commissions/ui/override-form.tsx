'use client';

import type { CreateCommissionServiceOverrideInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { OverrideDraft } from '../model/override-draft';
import { overrideServerAlerts } from '../model/override-messages';
import { createOverrideResolver } from '../model/override-resolver';
import { OverrideRuleFields } from './override-rule-fields';

interface OverrideFormProps {
  serviceId: string;
  initial: OverrideDraft;
  pending: boolean;
  serverError: unknown;
  onSubmit(body: CreateCommissionServiceOverrideInput): void;
  onClose(): void;
}

/**
 * نموذج التجاوز: التحقق بيشتغل مع كل تعديل، ورفض السيرفر بيفضل ظاهر لحد ما المدير يعدّل،
 * والحفظ مقفول طول ما الفورم مش صالح أو فيه حفظ شغال.
 */
export function OverrideForm({ serviceId, initial, pending, serverError, onSubmit, onClose }: OverrideFormProps) {
  const locale = useLocale();
  const form = useForm<OverrideDraft, unknown, CreateCommissionServiceOverrideInput>({
    resolver: createOverrideResolver(serviceId, locale),
    mode: 'onChange',
    defaultValues: initial,
  });
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);
  useEffect(() => {
    const subscription = form.watch((_values, { type }) => {
      if (type === 'change') {
        setDismissedFor(serverError);
        void form.trigger();
      }
    });
    return () => subscription.unsubscribe();
  }, [form, serverError]);
  useEffect(() => {
    void form.trigger();
  }, [form]);
  const dismissed = dismissedFor === serverError;
  const alerts = dismissed ? null : overrideServerAlerts(serverError, locale);
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((body) => onSubmit(body))} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <OverrideRuleFields dateAlert={alerts?.effectiveFrom ?? null} />
          <Button type="submit" disabled={!form.formState.isValid || pending}>
            {pending ? t(locale, 'commissionOverrides.saving') : t(locale, 'commissionOverrides.save')}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            {t(locale, 'commissionOverrides.cancel')}
          </Button>
        </fieldset>
        {alerts?.form != null ? <p role="alert">{alerts.form}</p> : null}
      </form>
    </FormProvider>
  );
}
