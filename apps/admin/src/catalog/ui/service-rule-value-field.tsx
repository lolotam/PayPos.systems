'use client';
import type { ServiceCommissionRuleInput } from '@pospay/contracts';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { serviceRuleFromText, serviceRuleValueText } from '../model/service-rule';

export function ServiceRuleValueField({
  kind,
  value,
  onChange,
}: {
  kind: 'PCT' | 'FIXED';
  value: ServiceCommissionRuleInput;
  onChange: (rule: ServiceCommissionRuleInput) => void;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="service-rule-value">
        {kind === 'PCT'
          ? t(locale, 'catalogServices.ruleBps')
          : t(locale, 'catalogServices.ruleFixed')}
      </Label>
      <Input
        id="service-rule-value"
        dir="ltr"
        inputMode="decimal"
        value={serviceRuleValueText(value)}
        onChange={(event) => onChange(serviceRuleFromText(kind, event.target.value))}
        onBlur={(event) => {
          if (kind === 'FIXED')
            onChange(serviceRuleFromText(kind, normalizeKwdInput(event.target.value)));
        }}
      />
    </>
  );
}
