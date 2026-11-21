'use client';

import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import type { ChangeEvent } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { OverrideDraft } from '../model/override-draft';

/**
 * حقول القاعدة: النوع بأربعة أنواع من العقد بس، والقيمة بتظهر بس للنسبة والمبلغ الثابت،
 * والمبلغ بيتطبّع على blur زي ما بتعمل شاشة الخطط.
 */
export function OverrideRuleFields({ dateAlert }: { dateAlert: string | null }) {
  const locale = useLocale();
  const { register, setValue, watch, formState } = useFormContext<OverrideDraft>();
  const kind = watch('kind');
  const valueField = kind === 'PCT' ? register('bps') : register('amount');
  const normalizeOnBlur = (event: ChangeEvent<HTMLInputElement>) => {
    valueField.onBlur(event);
    if (kind === 'FIXED')
      setValue('amount', normalizeKwdInput(event.target.value), { shouldValidate: true });
  };
  return (
    <>
      <Label htmlFor="override-kind">{t(locale, 'commissionOverrides.ruleKind')}</Label>
      <NativeSelect id="override-kind" {...register('kind')}>
        <option value="FOLLOW_PLAN">{t(locale, 'catalogServices.ruleFollowPlan')}</option>
        <option value="ZERO">{t(locale, 'catalogServices.ruleZero')}</option>
        <option value="PCT">{t(locale, 'catalogServices.rulePct')}</option>
        <option value="FIXED">{t(locale, 'catalogServices.ruleFixed')}</option>
      </NativeSelect>
      {formState.errors.kind?.message ? <p role="alert">{formState.errors.kind.message}</p> : null}
      {kind === 'PCT' || kind === 'FIXED' ? (
        <>
          <Label htmlFor="override-value">
            {kind === 'PCT'
              ? t(locale, 'commissionOverrides.bpsLabel')
              : t(locale, 'commissionOverrides.amountLabel')}
          </Label>
          <Input
            key={kind}
            id="override-value"
            dir="ltr"
            inputMode="decimal"
            {...valueField}
            onBlur={normalizeOnBlur}
          />
          {formState.errors.bps?.message ? (
            <p role="alert">{formState.errors.bps.message}</p>
          ) : null}
          {formState.errors.amount?.message ? (
            <p role="alert">{formState.errors.amount.message}</p>
          ) : null}
        </>
      ) : null}
      <Label htmlFor="override-date">{t(locale, 'commissionOverrides.effectiveFrom')}</Label>
      <Input id="override-date" type="date" dir="ltr" {...register('effectiveFrom')} />
      {formState.errors.effectiveFrom?.message ? (
        <p role="alert">{formState.errors.effectiveFrom.message}</p>
      ) : null}
      {dateAlert ? <p role="alert">{dateAlert}</p> : null}
    </>
  );
}
