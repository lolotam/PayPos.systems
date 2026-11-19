'use client';

import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';
import type { CommissionPlanWire } from '@pospay/commissions-engine/validation';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { toWireCandidate, type PlanDraft } from '../model/plan-draft';
import { planServerAlerts } from '../model/plan-messages';
import { createPlanResolver } from '../model/plan-resolver';
import { CalcFields } from './calc-fields';
import { PlanPeriodFields } from './plan-period-fields';
import { PlanSwitchBlock } from './plan-switch-block';
import { TiersBlock } from './tiers-block';

/**
 * نموذج بناء الخطة بلا طبقة بيانات: الحفظ متعطل طول ما النموذج غير صالح أو فيه حفظ شغال،
 * ورفض السيرفر بيتوجه لبلوكه أو للفورم، وأي تعديل بيخفي رسالة السيرفر فورًا.
 */
export function PlanBuilderForm({
  initial,
  pending,
  serverError,
  onSubmit,
}: {
  initial: PlanDraft;
  pending: boolean;
  serverError: unknown;
  onSubmit(body: CreateCommissionPlanVersionInput): void;
}) {
  const locale = useLocale();
  const form = useForm<PlanDraft, unknown, CreateCommissionPlanVersionInput>({
    resolver: createPlanResolver(locale),
    mode: 'onChange',
    defaultValues: initial,
  });
  const [dismissedFor, setDismissedFor] = useState<unknown>(null);
  useEffect(() => {
    const subscription = form.watch((_values, { type }) => {
      if (type === 'change') {
        setDismissedFor(serverError);
        // التحقق عند التغيير بيحدّث خطأ الحقل الملموس بس، والتمام هنا بيرجّع أخطاء كل البلوكات.
        void form.trigger();
      }
    });
    return () => subscription.unsubscribe();
  }, [form, serverError]);
  useEffect(() => {
    void form.trigger();
  }, [form]);
  const values = form.watch();
  const built = toWireCandidate(values);
  // الترشيح بيطلع جسم الطلب بصيغة العقد بالبناء، والفحص محتاج الشكل لا النوع.
  const body = built.errors.length > 0 ? null : (built.candidate as CommissionPlanWire);
  const dismissed = dismissedFor === serverError;
  const alerts = dismissed ? null : planServerAlerts(serverError, body, locale);
  const submit = form.handleSubmit((body) => onSubmit(body));
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <PlanPeriodFields />
          <PlanSwitchBlock block="base" serverAlert={alerts?.base ?? null}>
            <CalcFields id="base" path="base.calc" />
          </PlanSwitchBlock>
          <TiersBlock serverAlert={alerts?.tiers ?? null} />
          <PlanSwitchBlock block="packageSale" serverAlert={alerts?.packageSale ?? null}>
            <CalcFields id="package-sale" path="packageSale.calc" />
          </PlanSwitchBlock>
          <Button type="submit" disabled={!form.formState.isValid || pending}>
            {pending ? t(locale, 'commissionPlanBuilder.saving') : t(locale, 'commissionPlanBuilder.save')}
          </Button>
        </fieldset>
        {alerts?.form != null ? <p role="alert">{alerts.form}</p> : null}
      </form>
    </FormProvider>
  );
}
