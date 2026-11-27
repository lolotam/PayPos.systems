'use client';

import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';
import type { CommissionPlanWire } from '@pospay/commissions-engine/validation';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PlanDraft } from '../model/plan-draft';
import { planServerAlerts } from '../model/plan-messages';
import { createPlanResolver } from '../model/plan-resolver';
import { useServerErrorDismissal } from '../model/use-server-error-dismissal';
import { PlanBlocks } from './plan-blocks';
import { PlanPeriodFields } from './plan-period-fields';

interface PlanBuilderFormProps {
  initial: PlanDraft;
  pending: boolean;
  serverError: unknown;
  onSubmit(body: CreateCommissionPlanVersionInput): void;
}
/**
 * نموذج بناء الخطة بلا طبقة بيانات: الحفظ متعطل طول ما النموذج غير صالح أو فيه حفظ شغال،
 * ورفض السيرفر بيتحكّم على جسم الطلب المُرسول نفسه وبيظهر في بلوكه أو على الفورم،
 * وأي تعديل بيخفي رسالة السيرفر فورًا.
 */
export function PlanBuilderForm({ initial, pending, serverError, onSubmit }: PlanBuilderFormProps) {
  const locale = useLocale();
  const form = useForm<PlanDraft, unknown, CreateCommissionPlanVersionInput>({
    resolver: createPlanResolver(locale),
    mode: 'onChange',
    defaultValues: initial,
  });
  const { dismissed, dismiss } = useServerErrorDismissal(form, serverError);
  const [submittedBody, setSubmittedBody] = useState<CommissionPlanWire | null>(null);
  // الرسالة بيتحكّم عليها على الجسم اللي السيرفر حاكم عليه فعلاً مش على الجسم الحي، عشان ما تطيبش على بلوك غلط.
  const alerts = dismissed ? null : planServerAlerts(serverError, submittedBody, locale);
  const submit = form.handleSubmit((body) => {
    setSubmittedBody(body);
    onSubmit(body);
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <PlanPeriodFields />
          <PlanBlocks alerts={alerts} onUserEdit={dismiss} />
          <Button type="submit" disabled={!form.formState.isValid || pending}>
            {pending
              ? t(locale, 'commissionPlanBuilder.saving')
              : t(locale, 'commissionPlanBuilder.save')}
          </Button>
        </fieldset>
        {alerts?.form != null ? <p role="alert">{alerts.form}</p> : null}
      </form>
    </FormProvider>
  );
}
