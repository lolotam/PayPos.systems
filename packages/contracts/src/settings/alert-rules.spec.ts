import { expect, it } from 'vitest';

import { alertKind, setAlertRulesInput } from './alert-rules.js';

const ruleFor = (kind: (typeof alertKind.options)[number]) => ({
  kind,
  enabled: true,
  recipient_roles: [],
  channels: [],
  delay_minutes: null,
  lead_minutes: null,
  expected_revision: null,
  expected_rule_id: null,
});

// الحد الأقصى بيتشتق من قائمة الأنواع: طلب فيه كل نوع مرة لازم يعدّي مهما زاد عدد الأنواع.
it('accepts one update that carries every alert kind exactly once', () => {
  const rules = alertKind.options.map(ruleFor);
  expect(rules.length).toBe(alertKind.options.length);
  expect(setAlertRulesInput.safeParse({ rules }).success).toBe(true);
});

it('still refuses a repeated kind and a list longer than the catalog', () => {
  const rules = alertKind.options.map(ruleFor);
  const repeated = [...rules, ...rules.slice(0, 1)];
  expect(setAlertRulesInput.safeParse({ rules: repeated }).success).toBe(false);
  expect(setAlertRulesInput.safeParse({ rules: [] }).success).toBe(false);
});
