import { alertKind } from '@pospay/contracts';
import { expect, it } from 'vitest';
import { listedAlertKinds } from './listed-alert-kinds';
import { parseAlertRules } from './parse-alert-rules';

const BUSINESS = '01920000-0000-7000-8000-0000000000a4';

function view(kind: string) {
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

const envelope = (kinds: readonly string[]) => ({
  business_id: BUSINESS,
  branch_id: null,
  alerts_enabled: true,
  rules: kinds.map(view),
});

it('drops an unknown future kind and keeps every known rule', () => {
  const parsed = parseAlertRules(envelope([...alertKind.options, 'FUTURE_KIND_FROM_NEWER_API']));

  expect(parsed.rules.map((rule) => rule.kind)).toEqual([...alertKind.options]);
  expect(listedAlertKinds(parsed.rules, false).length).toBeGreaterThan(0);
});

it('still refuses a known kind whose rule is malformed', () => {
  const broken = {
    ...envelope([]),
    rules: [{ ...view('SHIFT_NOT_CLOCKED_IN'), channels: ['PIGEON'] }],
  };

  expect(() => parseAlertRules(broken)).toThrow();
});

it('still refuses an entry whose kind is missing or not a string', () => {
  const known = view('SHIFT_NOT_CLOCKED_IN');
  const withoutKind = Object.fromEntries(Object.entries(known).filter(([key]) => key !== 'kind'));

  expect(() => parseAlertRules({ ...envelope([]), rules: [withoutKind] })).toThrow();
  expect(() => parseAlertRules({ ...envelope([]), rules: [{ ...known, kind: 123 }] })).toThrow();
  expect(() => parseAlertRules({ ...envelope([]), rules: [{ ...known, kind: null }] })).toThrow();
});

it('still refuses a payload that is not an alert-rules envelope', () => {
  expect(() => parseAlertRules({ rules: 'nope' })).toThrow();
  expect(() => parseAlertRules(null)).toThrow();
});
