import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';

export type AlertRuleInput = SetAlertRulesInput['rules'][number];
export type AlertRulesDraft = SetAlertRulesInput;

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  const other = new Set(right);
  if (values.size !== other.size) return false;
  return right.every((value) => values.has(value));
}

export function alertRulesSaveBody(
  server: AlertRules,
  draft: AlertRulesDraft,
): SetAlertRulesInput | null {
  const stored = new Map(server.rules.map((rule) => [rule.kind, rule]));
  const rules = draft.rules.filter((entry) => {
    const rule = stored.get(entry.kind);
    if (!rule) return false;
    return (
      entry.enabled !== rule.enabled ||
      !sameSet(entry.recipient_roles, rule.recipient_roles) ||
      !sameSet(entry.channels, rule.channels) ||
      entry.delay_minutes !== rule.delay_minutes ||
      entry.lead_minutes !== rule.lead_minutes
    );
  });
  return rules.length === 0 ? null : { rules };
}
