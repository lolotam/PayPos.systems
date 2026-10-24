'use client';

import type { ResetBranchAlertRuleQuery, SetAlertRulesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { useAlertRulesWriting } from '../api/use-alert-rules-writing';
import { useResetBranchAlertRule } from '../api/use-reset-branch-alert-rule';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';
import { alertRuleKindLabel, alertRulesText } from '../model/alert-rules-text';
import type { ListedAlertRuleView } from '../model/listed-alert-kinds';

type ResetBranchRuleButtonProps = {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  rule: ListedAlertRuleView;
  index: number;
  disabled: boolean;
  onDone: () => void;
  onConflict: () => void;
};

function useBranchResetAction(props: ResetBranchRuleButtonProps) {
  const { companyId, userId, businessId, branchId, rule, index, onDone, onConflict } = props;
  const form = useFormContext<SetAlertRulesInput>();
  const writing = useAlertRulesWriting(companyId, userId, businessId);
  const [missingExpected, setMissingExpected] = useState(false);
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
    if (entry.expected_rule_id === null || entry.expected_revision === null) {
      setMissingExpected(true);
      onConflict();
      return;
    }
    setMissingExpected(false);
    const expected: ResetBranchAlertRuleQuery = {
      expected_rule_id: entry.expected_rule_id,
      expected_revision: entry.expected_revision,
    };
    mutation.mutate({ kind: rule.kind, expected });
  };
  return { reset, missingExpected, mutation, disabled: props.disabled || writing };
}

export function ResetBranchRuleButton(props: ResetBranchRuleButtonProps) {
  const locale = useLocale();
  const action = useBranchResetAction(props);
  const failure = action.missingExpected
    ? t(locale, 'errors.ALERT_RULE_REVISION_CONFLICT')
    : action.mutation.isError
      ? alertRulesFailureMessage(action.mutation.error, locale)
      : null;
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label={alertRulesText(t(locale, 'alertRules.resetToBusiness'), {
          kind: alertRuleKindLabel(locale, props.rule.kind),
        })}
        disabled={action.disabled || action.mutation.isPending}
        onClick={action.reset}
      >
        {t(locale, 'alertRules.resetToBusinessText')}
      </Button>
      {failure ? <p role="alert">{failure}</p> : null}
    </div>
  );
}
