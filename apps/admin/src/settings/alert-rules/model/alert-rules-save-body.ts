import type { AlertRules, SetAlertRulesInput } from '@pospay/contracts';

export type AlertRuleInput = SetAlertRulesInput['rules'][number];
export type AlertRulesDraft = SetAlertRulesInput;

function sameRoles(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  const other = new Set(right);
  if (values.size !== other.size) return false;
  return right.every((role) => values.has(role));
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
      !sameRoles(entry.recipient_roles, rule.recipient_roles) ||
      entry.delay_minutes !== rule.delay_minutes ||
      entry.lead_minutes !== rule.lead_minutes
    );
  });
  return rules.length === 0 ? null : { rules };
}
