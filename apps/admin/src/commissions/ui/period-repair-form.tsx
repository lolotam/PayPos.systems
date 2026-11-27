'use client';

import type { CreateCommissionPeriodRepairInput } from '@pospay/contracts';
import type { CommissionPlanWire } from '@pospay/commissions-engine/validation';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { emptyRepairPlanDraft, type RepairPlanDraft } from '../model/plan-draft';
import { planServerAlerts } from '../model/plan-messages';
import { createRepairPlanResolver } from '../model/plan-resolver';
import { useServerErrorDismissal } from '../model/use-server-error-dismissal';
import { PlanBlocks } from './plan-blocks';
import { planRefusalMessage } from './plan-server-messages';

type RepairPlan = CreateCommissionPeriodRepairInput['plan'];

interface PeriodRepairFormProps {
  pending: boolean;
  serverError: unknown;
  onSubmit(plan: RepairPlan): void;
  onClose(): void;
}

/**
 * نموذج خطة إصلاح شهر مقفول: نفس البلوكات التلاتة بتاعة منشئ الخطة من غير تاريخ سريان ولا كامل الفترة، لأن
 * الإصلاح بيسري في شهره بس. الحفظ متعطل طول ما النموذج غير صالح أو الطلب شغال، أو كل البلوكات مقفولة من غير تأكيد صريح لخطة بصفر عمولة، ورفض السيرفر بيظهر في بلوكه
 * أو على النموذج وأي تعديل بيخفيه.
 */
export function PeriodRepairForm({ pending, serverError, onSubmit, onClose }: PeriodRepairFormProps) {
  const locale = useLocale();
  const form = useForm<RepairPlanDraft, unknown, RepairPlan>({
    resolver: createRepairPlanResolver(locale),
    mode: 'onChange',
    defaultValues: emptyRepairPlanDraft(),
  });
  const { dismissed, dismiss } = useServerErrorDismissal(form, serverError);
  const [baseOn, tiersOn, packageOn] = form.watch(['base.enabled', 'tiers.enabled', 'packageSale.enabled']);
  const allOff = !baseOn && !tiersOn && !packageOn;
  const [confirmZero, setConfirmZero] = useState(false);
  const [submitted, setSubmitted] = useState<CommissionPlanWire | null>(null);
  const alerts = dismissed ? null : planServerAlerts(serverError, submitted, locale);
  // رفض «مفيش تصحيح موقوف للإصلاح» له رسالته في كتالوج الأخطاء، وغيره بيعرض رسالة planServerAlerts.
  const notAllowed =
    (serverError as { code?: unknown } | null)?.code === 'COMMISSION_REPAIR_NOT_ALLOWED';
  const formAlert =
    alerts?.form == null ? null : notAllowed ? planRefusalMessage(serverError, locale) : alerts.form;
  const submit = form.handleSubmit((plan) => {
    setSubmitted(plan);
    onSubmit(plan);
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-start">
        <fieldset disabled={pending} className="flex flex-col gap-3">
          <PlanBlocks alerts={alerts} onUserEdit={dismiss} />
          {allOff ? (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmZero}
                onChange={(event) => setConfirmZero(event.target.checked)}
              />
              {t(locale, 'commissionPlanBuilder.repairConfirmZero')}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!form.formState.isValid || pending || (allOff && !confirmZero)}
            >
              {t(locale, pending ? 'commissionPlanBuilder.repairSubmitting' : 'commissionPlanBuilder.repairSubmit')}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              {t(locale, 'commissionPlanBuilder.repairCancel')}
            </Button>
          </div>
        </fieldset>
        {formAlert !== null ? <p role="alert">{formAlert}</p> : null}
      </form>
    </FormProvider>
  );
}
