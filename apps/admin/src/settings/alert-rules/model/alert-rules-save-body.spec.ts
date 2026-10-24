import type { AlertRules } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { buildAlertRulesDraft } from './alert-rules-draft';
import { alertRulesSaveBody } from './alert-rules-save-body';

const businessId = '01920000-0000-7000-8000-0000000000a2';
const ruleId = '01920000-0000-7000-8000-0000000000a3';

function server(overrides: Partial<AlertRules['rules'][number]> = {}): AlertRules {
  return {
    business_id: businessId,
    branch_id: null,
    alerts_enabled: true,
    rules: [
      {
        kind: 'SHIFT_NOT_CLOCKED_IN',
        source: 'BUSINESS',
        enabled: true,
        recipient_roles: ['owner', 'branch_manager'],
        channels: ['IN_APP'],
        delay_minutes: 20,
        lead_minutes: null,
        fixed_recipients: [{ selector: 'EMPLOYEE_PUSH', permission: null, who: null }],
        revision: 4,
        rule_id: ruleId,
        ...overrides,
      },
      {
        kind: 'SERVICE_LINE_CANCELLED',
        source: 'DEFAULT',
        enabled: false,
        recipient_roles: ['owner'],
        channels: ['IN_APP'],
        delay_minutes: null,
        lead_minutes: null,
        fixed_recipients: [],
        revision: null,
        rule_id: null,
      },
    ],
  };
}

it('returns null for an untouched draft', () => {
  expect(alertRulesSaveBody(server(), buildAlertRulesDraft(server()))).toBeNull();
});

it('sends only the changed kind with its concurrency values', () => {
  const view = server();
  const draft = buildAlertRulesDraft(view);
  draft.rules[0]!.enabled = false;
  expect(alertRulesSaveBody(view, draft)).toEqual({
    rules: [{ ...draft.rules[0]!, expected_revision: 4, expected_rule_id: ruleId }],
  });
});

it('treats reordered but equal roles as unchanged', () => {
  const view = server();
  const draft = buildAlertRulesDraft(view);
  draft.rules[0]!.recipient_roles.reverse();
  expect(alertRulesSaveBody(view, draft)).toBeNull();
});

it('sends a changed delay', () => {
  const view = server();
  const draft = buildAlertRulesDraft(view);
  draft.rules[0]!.delay_minutes = 15;
  expect(alertRulesSaveBody(view, draft)?.rules).toHaveLength(1);
  expect(alertRulesSaveBody(view, draft)?.rules[0]?.delay_minutes).toBe(15);
});

it('keeps null concurrency values for the first rule at this scope', () => {
  const view = server({ source: 'DEFAULT', revision: null, rule_id: null });
  const draft = buildAlertRulesDraft(view);
  draft.rules[0]!.enabled = false;
  const entry = alertRulesSaveBody(view, draft)?.rules[0];
  expect(entry?.expected_revision).toBeNull();
  expect(entry?.expected_rule_id).toBeNull();
});

it('builds the draft from server values without read-only fields', () => {
  const draft = buildAlertRulesDraft(server());
  expect(draft.rules[0]).toEqual({
    kind: 'SHIFT_NOT_CLOCKED_IN',
    enabled: true,
    recipient_roles: ['owner', 'branch_manager'],
    channels: ['IN_APP'],
    delay_minutes: 20,
    lead_minutes: null,
    expected_revision: 4,
    expected_rule_id: ruleId,
  });
});
