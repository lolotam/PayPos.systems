'use client';

import { ALERT_KIND_DEFINITIONS } from '@pospay/domain';
import type { SetAlertRulesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-draft';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';

export function AlertRuleMinutesField({
  rule,
  index,
  disabled,
}: {
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
}) {
  const locale = useLocale();
  const form = useFormContext<SetAlertRulesInput>();
  const definition = ALERT_KIND_DEFINITIONS[rule.kind];
  if (!definition.hasDelay && !definition.hasLead) return null;
  const field = definition.hasDelay ? 'delay_minutes' : 'lead_minutes';
  const id = `alert-rule-${index}-${field}`;
  const template = definition.hasDelay ? 'alertRules.delayLabel' : 'alertRules.leadLabel';
  const label = alertRulesText(t(locale, template), {
    kind: alertRuleKindLabel(locale, rule.kind),
  });
  return (
    <div className="flex max-w-xs flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...form.register(`rules.${index}.${field}`, { valueAsNumber: true })}
        id={id}
        type="number"
        min={1}
        max={1440}
        step={1}
        disabled={disabled}
        className="tabular-nums"
      />
    </div>
  );
}
