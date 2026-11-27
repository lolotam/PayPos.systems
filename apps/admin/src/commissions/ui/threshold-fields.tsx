'use client';

import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import type { ChangeEvent } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { RepairPlanDraft } from '../model/plan-draft';
import type { StepPath } from './plan-form-types';

/** حقلا حد الشريحة وقيمته لنص واحد؛ تطبيع مبلغ الحد على blur فقط كي لا تتقاطع الكتابة مع القيمة. */
export function ThresholdFields({ id, path }: { id: string; path: StepPath }) {
  const locale = useLocale();
  const { register, setValue, watch } = useFormContext<RepairPlanDraft>();
  const kind = watch(`${path}.fromKind`);
  const valueField = register(`${path}.fromValue`);
  const normalizeOnBlur = (event: ChangeEvent<HTMLInputElement>) => {
    valueField.onBlur(event);
    if (kind === 'AMOUNT') {
      setValue(`${path}.fromValue`, normalizeKwdInput(event.target.value), {
        shouldValidate: true,
      });
    }
  };
  return (
    <>
      <Label htmlFor={`${id}-kind`}>{t(locale, 'commissionPlanBuilder.thresholdKind')}</Label>
      <NativeSelect id={`${id}-kind`} {...register(`${path}.fromKind`)}>
        <option value="AMOUNT">{t(locale, 'commissionPlanBuilder.thresholdAmount')}</option>
        <option value="SESSIONS">{t(locale, 'commissionPlanBuilder.thresholdSessions')}</option>
        <option value="SALARY_MULTIPLE">
          {t(locale, 'commissionPlanBuilder.thresholdMultiple')}
        </option>
      </NativeSelect>
      <Label htmlFor={`${id}-value`}>{t(locale, 'commissionPlanBuilder.thresholdValue')}</Label>
      <Input
        id={`${id}-value`}
        dir="ltr"
        inputMode="decimal"
        {...valueField}
        onBlur={normalizeOnBlur}
      />
    </>
  );
}
