'use client';

import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import type { ChangeEvent } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { RepairPlanDraft } from '../model/plan-draft';
import type { CalcPath } from './plan-form-types';

/**
 * حقلا طريقة الحساب وقيمته لنص واحد؛ نص المبلغ بلغة لاتينية وبيتطبّع على blur بس
 * عشان الكتابة ما تتعطلش والنص الغلط بيفضل زي ما هو؛ وkey بيركّب حقل القيمة عند تغيير النوع
 * لأن الرجوع لاسم سابق بيطابق ref العقدة القديمة فيطّلع إعادة القراءة فيبقى المعروض غير المرسل.
 */
export function CalcFields({ id, path }: { id: string; path: CalcPath }) {
  const locale = useLocale();
  const { register, setValue, watch } = useFormContext<RepairPlanDraft>();
  const kind = watch(`${path}.kind`);
  const valueField = kind === 'PCT' ? register(`${path}.bps`) : register(`${path}.amount`);
  const normalizeOnBlur = (event: ChangeEvent<HTMLInputElement>) => {
    valueField.onBlur(event);
    if (kind === 'FIXED') {
      setValue(`${path}.amount`, normalizeKwdInput(event.target.value), { shouldValidate: true });
    }
  };
  return (
    <>
      <Label htmlFor={`${id}-kind`}>{t(locale, 'commissionPlanBuilder.calcKind')}</Label>
      <NativeSelect id={`${id}-kind`} {...register(`${path}.kind`)}>
        <option value="PCT">{t(locale, 'commissionPlanBuilder.calcPct')}</option>
        <option value="FIXED">{t(locale, 'commissionPlanBuilder.calcFixed')}</option>
      </NativeSelect>
      <Label htmlFor={`${id}-value`}>
        {kind === 'PCT'
          ? t(locale, 'commissionPlanBuilder.bpsLabel')
          : t(locale, 'commissionPlanBuilder.amountLabel')}
      </Label>
      <Input
        key={kind}
        id={`${id}-value`}
        dir="ltr"
        inputMode="decimal"
        {...valueField}
        onBlur={normalizeOnBlur}
      />
    </>
  );
}
