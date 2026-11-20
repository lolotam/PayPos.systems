'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { CalcFields } from './calc-fields';
import { ThresholdFields } from './threshold-fields';

/** حقول شريحة واحدة: الحد وطريقة الحساب وزر حذفها، بترقيم ظاهر للمدير. */
export function TiersStepFields({
  index,
  id,
  onRemove,
}: {
  index: number;
  id: string;
  onRemove(): void;
}) {
  const locale = useLocale();
  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
      <legend className="font-semibold">
        {t(locale, 'commissionPlanBuilder.step')} {index + 1}
      </legend>
      <ThresholdFields id={`tier-step-${id}-threshold`} path={`tiers.steps.${index}`} />
      <CalcFields id={`tier-step-${id}-calc`} path={`tiers.steps.${index}.calc`} />
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>
        {t(locale, 'commissionPlanBuilder.removeStep')}
      </Button>
    </fieldset>
  );
}
