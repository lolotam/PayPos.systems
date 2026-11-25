'use client';
import type { CreateServiceInput } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Label, Select } from '@pospay/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  defaultServiceRule,
  SERVICE_RULE_KINDS,
  type ServiceRuleKind,
} from '../model/service-rule';
import { wrapServiceGridCell } from './service-basics-fields';
import { ServiceRuleValueField } from './service-rule-value-field';

const KIND_LABEL: Record<ServiceRuleKind, MessageKey> = {
  FOLLOW_PLAN: 'catalogServices.ruleFollowPlan',
  ZERO: 'catalogServices.ruleZero',
  PCT: 'catalogServices.rulePct',
  FIXED: 'catalogServices.ruleFixed',
};

function CommissionRuleControl({ grid }: { grid: boolean }) {
  const locale = useLocale();
  const { control } = useFormContext<CreateServiceInput>();
  return (
    <Controller
      name="commission_rule"
      control={control}
      render={({ field }) => {
        const kind = field.value.kind;
        const ruleField = (
          <>
            <Label htmlFor="service-rule">{t(locale, 'catalogServices.rule')}</Label>
            <Select
              id="service-rule"
              value={kind}
              onValueChange={(next) =>
                field.onChange(defaultServiceRule(next as ServiceRuleKind))
              }
              options={SERVICE_RULE_KINDS.map((value) => ({
                value,
                label: t(locale, KIND_LABEL[value]),
              }))}
            />
          </>
        );
        const valueField =
          kind === 'PCT' || kind === 'FIXED' ? (
            <ServiceRuleValueField kind={kind} value={field.value} onChange={field.onChange} />
          ) : null;
        return (
          <>
            {wrapServiceGridCell(grid, 'standard', ruleField)}
            {valueField ? wrapServiceGridCell(grid, 'short', valueField) : null}
          </>
        );
      }}
    />
  );
}

function ThresholdControl({ grid }: { grid: boolean }) {
  const locale = useLocale();
  const { control } = useFormContext<CreateServiceInput>();
  return wrapServiceGridCell(
    grid,
    'standard',
    <>
      <Label htmlFor="service-threshold">
        {t(locale, 'catalogServices.countsTowardThreshold')}
      </Label>
      <Controller
        name="counts_toward_threshold"
        control={control}
        render={({ field }) => (
          <Select
            id="service-threshold"
            value={field.value ? 'yes' : 'no'}
            onValueChange={(next) => field.onChange(next === 'yes')}
            options={[
              { value: 'yes', label: t(locale, 'catalogServices.countsYes') },
              { value: 'no', label: t(locale, 'catalogServices.countsNo') },
            ]}
          />
        )}
      />
    </>,
  );
}

export function ServiceRuleFields({ grid = false }: { grid?: boolean }) {
  const content = (
    <>
      <CommissionRuleControl grid={grid} />
      <ThresholdControl grid={grid} />
    </>
  );
  return grid ? <div className="grid grid-cols-12 gap-4">{content}</div> : content;
}
