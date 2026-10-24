import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';
import { listedAlertKinds } from './listed-alert-kinds';

export function buildAlertRulesDraft(server: AlertRules): SetAlertRulesInput {
  return {
    rules: listedAlertKinds(server.rules, server.branch_id !== null).map((rule) => ({
      kind: rule.kind,
      enabled: rule.enabled,
      recipient_roles: [...rule.recipient_roles],
      channels: [...rule.channels],
      delay_minutes: rule.delay_minutes,
      lead_minutes: rule.lead_minutes,
      expected_revision: rule.revision,
      expected_rule_id: rule.rule_id,
    })),
  };
}
