'use client';

import type { ResetBranchAlertRuleQuery, SetAlertRulesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useResetBranchAlertRule } from '../api/use-reset-branch-alert-rule';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-text';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';

export function ResetBranchRuleButton({
  companyId,
  userId,
  businessId,
  branchId,
  rule,
  index,
  disabled,
  onDone,
  onConflict,
}: {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
  onDone: () => void;
  onConflict: () => void;
}) {
  const locale = useLocale();
  const form = useFormContext<SetAlertRulesInput>();
  const mutation = useResetBranchAlertRule(
    companyId,
    userId,
    businessId,
    branchId,
    onDone,
    onConflict,
  );
  const reset = () => {
    const entry = form.getValues(`rules.${index}`);
    if (entry.expected_rule_id === null || entry.expected_revision === null) return;
    const expected: ResetBranchAlertRuleQuery = {
      expected_rule_id: entry.expected_rule_id,
      expected_revision: entry.expected_revision,
    };
    mutation.mutate({ kind: rule.kind, expected });
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label={alertRulesText(t(locale, 'alertRules.resetToBusiness'), {
          kind: alertRuleKindLabel(locale, rule.kind),
        })}
        disabled={disabled || mutation.isPending}
        onClick={reset}
      >
        {t(locale, 'alertRules.resetToBusinessText')}
      </Button>
      {mutation.isError ? (
        <p role="alert">{alertRulesFailureMessage(mutation.error, locale)}</p>
      ) : null}
    </div>
  );
}
