'use client';

import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PlanDraft } from '../model/plan-draft';

/** حقلا تاريخ النشاط وكامل الفترة، وتنبيه رفض التاريخ بيظهر تحت الحقل نفسه. */
export function PlanPeriodFields() {
  const locale = useLocale();
  const { formState, register } = useFormContext<PlanDraft>();
  const dateError = formState.errors.effectiveFrom?.message;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="plan-effective-from">
        {t(locale, 'commissionPlanBuilder.effectiveFrom')}
      </Label>
      <Input id="plan-effective-from" type="date" dir="ltr" {...register('effectiveFrom')} />
      {typeof dateError === 'string' ? <p role="alert">{dateError}</p> : null}
      <div className="flex items-center gap-3">
        <input id="plan-whole-period" type="checkbox" role="switch" {...register('wholePeriod')} />
        <Label htmlFor="plan-whole-period">{t(locale, 'commissionPlanBuilder.wholePeriod')}</Label>
      </div>
    </div>
  );
}
