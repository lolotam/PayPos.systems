'use client';

import type { ResetBranchAlertRuleQuery } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useResetBranchAlertRule } from '../api/use-reset-branch-alert-rule';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-draft';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';

export function ResetBranchRuleButton({
  companyId,
  userId,
  businessId,
  branchId,
  rule,
  disabled,
  onDone,
}: {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  rule: ListedAlertRuleView;
  disabled: boolean;
  onDone: () => void;
}) {
  const locale = useLocale();
  const mutation = useResetBranchAlertRule(companyId, userId, businessId, branchId, onDone);
  const reset = () => {
    if (rule.rule_id === null || rule.revision === null) return;
    const expected: ResetBranchAlertRuleQuery = {
      expected_rule_id: rule.rule_id,
      expected_revision: rule.revision,
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
