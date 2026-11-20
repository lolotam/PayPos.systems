'use client';

import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { PlanDraft, StepDraft } from '../model/plan-draft';
import { PlanSwitchBlock } from './plan-switch-block';
import { TiersStepFields } from './tiers-step-fields';

/** شريحة جديدة فاضية؛ كل ضغطة بتاخد نسخة جديدة عشان ما تتشاركش السطور نفس الكائن. */
function emptyStep(): StepDraft {
  return { fromKind: 'AMOUNT', fromValue: '', calc: { kind: 'PCT', bps: '', amount: '' } };
}

/** بلوك الشرائح: النمط والمجمّع وقائمة الشرائح بالإضافة والحذف عبر useFieldArray. */
export function TiersBlock({ serverAlert }: { serverAlert?: string | null }) {
  const locale = useLocale();
  const { control, register, setValue, trigger } = useFormContext<PlanDraft>();
  const { append, fields, remove } = useFieldArray({ control, name: 'tiers.steps' });
  const markTouched = () => setValue('tiers.touched', true, { shouldValidate: true });
  return (
    <PlanSwitchBlock block="tiers" serverAlert={serverAlert}>
      <div onChangeCapture={markTouched} className="flex flex-col gap-3">
        <Label htmlFor="tiers-mode">{t(locale, 'commissionPlanBuilder.mode')}</Label>
        <NativeSelect id="tiers-mode" {...register('tiers.mode')}>
          <option value="MARGINAL">{t(locale, 'commissionPlanBuilder.modeMarginal')}</option>
          <option value="WHOLE">{t(locale, 'commissionPlanBuilder.modeWhole')}</option>
        </NativeSelect>
        <Label htmlFor="tiers-accumulator">
          {t(locale, 'commissionPlanBuilder.accumulator')}
        </Label>
        <NativeSelect id="tiers-accumulator" {...register('tiers.accumulator')}>
          <option value="AMOUNT">{t(locale, 'commissionPlanBuilder.accumulatorAmount')}</option>
          <option value="SESSIONS">
            {t(locale, 'commissionPlanBuilder.accumulatorSessions')}
          </option>
        </NativeSelect>
        {fields.map((field, index) => (
          <TiersStepFields
            key={field.id}
            index={index}
            id={field.id}
            onRemove={() => {
              remove(index);
              markTouched();
              // الإضافة والحذف من useFieldArray مش بيطلعوا حدث change، فالتمام هنا هو اللي بيرجّع رسالة البلوك.
              void trigger();
            }}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            append(emptyStep());
            markTouched();
            void trigger();
          }}
        >
          {t(locale, 'commissionPlanBuilder.addStep')}
        </Button>
      </div>
    </PlanSwitchBlock>
  );
}
