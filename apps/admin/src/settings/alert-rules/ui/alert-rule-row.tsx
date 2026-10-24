'use client';

import type { SetAlertRulesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge, Label } from '@pospay/ui';
import Link from 'next/link';
import { useController } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { alertRuleKindLabel } from '../model/alert-rules-text';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';
import { AlertRuleMinutesField } from './alert-rule-minutes-field';
import { AlertRuleRecipients } from './alert-rule-recipients';
import { ResetBranchRuleButton } from './reset-branch-rule-button';

type AlertRuleRowProps = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string | null;
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
  onResetDone: () => void;
  onResetConflict: () => void;
};

export function AlertRuleRow(props: AlertRuleRowProps) {
  const { companyId, userId, businessId, branchId, rule, index, disabled, onResetDone, onResetConflict } =
    props;
  const locale = useLocale();
  const { field } = useController<SetAlertRulesInput, `rules.${number}.enabled`>({
    name: `rules.${index}.enabled`,
  });
  const id = `alert-rule-${index}-enabled`;
  const label = alertRuleKindLabel(locale, rule.kind);
  return (
    <fieldset className="flex flex-col gap-4 rounded-card border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-label={label}
          checked={field.value}
          disabled={disabled}
          onChange={(event) => field.onChange(event.target.checked)}
        />
        <Label htmlFor={id}>{label}</Label>
        <Badge variant="secondary">{t(locale, `alertRules.source_${rule.source}`)}</Badge>
      </div>
      <AlertRuleRecipients rule={rule} index={index} disabled={disabled} />
      <AlertRuleMinutesField rule={rule} index={index} disabled={disabled} />
      {rule.kind === 'DOCUMENT_EXPIRING' ? (
        <p className="text-sm text-muted-foreground">
          {t(locale, 'alertRules.documentWindow')}{' '}
          <Link className="text-link underline" href="/staff/document-types">
            {t(locale, 'alertRules.documentTypesLink')}
          </Link>
        </p>
      ) : null}
      {branchId !== null && rule.source === 'BRANCH' ? (
        <ResetBranchRuleButton
          companyId={companyId}
          userId={userId}
          businessId={businessId}
          branchId={branchId}
          rule={rule}
          index={index}
          disabled={disabled}
          onDone={onResetDone}
          onConflict={onResetConflict}
        />
      ) : null}
    </fieldset>
  );
}
