import { alertKind, type AlertRules } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { listedAlertKinds, type AlertRuleView } from './listed-alert-kinds';

function rule(kind: AlertRuleView['kind']): AlertRuleView {
  return {
    kind,
    source: 'DEFAULT',
    enabled: true,
    recipient_roles: [],
    channels: ['IN_APP'],
    delay_minutes: null,
    lead_minutes: null,
    fixed_recipients: [],
    revision: null,
    rule_id: null,
  };
}

const rules: AlertRules['rules'] = alertKind.options.map(rule);
const listed = [
  'SHIFT_NOT_CLOCKED_IN',
  'SHIFT_BREAK_NOT_RETURNED',
  'SHIFT_BREAK_RETURNED_OTHER_BRANCH',
  'SHIFT_ENDS_SOON',
  'ATTENDANCE_EXCEPTION',
  'DOCUMENT_EXPIRING',
  'LATE_SERVICE_SESSION',
  'SERVICE_LINE_EDITED',
  'SERVICE_LINE_CANCELLED',
  'SERVICE_LINE_PERFORMERS_CHANGED',
  'ATTENDANCE_CHANGE_REQUESTED',
  'ATTENDANCE_CHANGE_DECIDED',
  'DISCOUNT_SELF_APPROVED',
];

it('lists exactly the thirteen emitted kinds in business order', () => {
  expect(listedAlertKinds(rules, false).map((rule) => rule.kind)).toEqual(listed);
});

it('also removes document expiry from the branch view', () => {
  expect(listedAlertKinds(rules, true).map((rule) => rule.kind)).toEqual(
    listed.filter((kind) => kind !== 'DOCUMENT_EXPIRING'),
  );
});

it('lists the 057-3b self-approval kind while the deferred STATEMENT kinds stay unlisted', () => {
  const business = listedAlertKinds(rules, false);
  const selfApproval = business.find((rule) => rule.kind === 'DISCOUNT_SELF_APPROVED');
  expect(selfApproval).toBeDefined();
  expect(selfApproval).toMatchObject({ enabled: true, source: 'DEFAULT' });
  // editable like any listed kind: it survives the branch view too (it is branch-scoped).
  expect(listedAlertKinds(rules, true).map((rule) => rule.kind)).toContain('DISCOUNT_SELF_APPROVED');
  for (const kind of ['STATEMENT_AWAITING_REVIEW', 'STATEMENT_AWAITING_APPROVAL'] as const)
    expect(business.map((rule) => rule.kind)).not.toContain(kind);
});
