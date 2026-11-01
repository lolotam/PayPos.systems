import { expect, it } from 'vitest';

import type {
  CommissionRuleLine,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from '../commission-types.ts';
import { resolveServiceCommissionRule } from '../service-rule.ts';

// لقطة البند الافتراضية نسبة 1000 بيس، عشان تختلف عن أي تجاوز صريح في الاختبار.
const ruleLine = (patch: Partial<CommissionRuleLine> = {}): CommissionRuleLine => ({
  employeeId: 'employee-a',
  serviceId: 'service-a',
  businessDate: '2026-10-10',
  ruleSnapshot: { kind: 'PCT', value: 1000n },
  ...patch,
});

const override = (patch: Partial<ServiceCommissionOverride> = {}): ServiceCommissionOverride => ({
  id: 'override-a',
  employeeId: 'employee-a',
  serviceId: 'service-a',
  effectiveFrom: '2026-10-01',
  createdAt: 1n,
  rule: { kind: 'FOLLOW_SERVICE' },
  ...patch,
});

it('the reset applies from its effective date and the day before the older override still applies', () => {
  const older = override({ id: 'override-old', createdAt: 1n, rule: { kind: 'PCT', value: 500n } });
  const reset = override({ id: 'override-reset', createdAt: 2n, effectiveFrom: '2026-10-10' });
  // قبل تاريخ السريان: التجاوز الأقدم هو الساري.
  expect(
    resolveServiceCommissionRule(ruleLine({ businessDate: '2026-10-09' }), [older, reset]),
  ).toEqual({ kind: 'PCT', value: 500n });
  // من تاريخ السريان: لقطة البند هي السارية والتجاوز الأقدم لا يرجع.
  expect(
    resolveServiceCommissionRule(ruleLine({ businessDate: '2026-10-10' }), [older, reset]),
  ).toEqual({ kind: 'PCT', value: 1000n });
});

it('the reset never falls through to an older override, even when that one has the later effective date', () => {
  const older = override({
    id: 'override-old',
    createdAt: 1n,
    effectiveFrom: '2026-10-10',
    rule: { kind: 'PCT', value: 500n },
  });
  const reset = override({ id: 'override-reset', createdAt: 2n, effectiveFrom: '2026-10-09' });
  expect(resolveServiceCommissionRule(ruleLine(), [older, reset])).toEqual({ kind: 'PCT', value: 1000n });
});

it('the reset competes by createdAt then id, not by effective date or input order', () => {
  const reset = override({ id: 'override-reset', createdAt: 5n, effectiveFrom: '2026-10-10' });
  const explicit = override({
    id: 'override-explicit',
    createdAt: 6n,
    effectiveFrom: '2026-10-01',
    rule: { kind: 'PCT', value: 500n },
  });
  // الأحدث إنشاءً يفوز رغم أن تاريخ سريان التجاوز الأقدم هو الأحدث.
  expect(resolveServiceCommissionRule(ruleLine(), [reset, explicit])).toEqual({ kind: 'PCT', value: 500n });
  expect(resolveServiceCommissionRule(ruleLine(), [explicit, reset])).toEqual({ kind: 'PCT', value: 500n });
  // عند تساوي وقت الإنشاء، أكبر هوية تفوز: override-reset يتخطى override-explicit.
  const tieReset = override({ id: 'override-reset', createdAt: 7n });
  const tieExplicit = override({
    id: 'override-explicit',
    createdAt: 7n,
    rule: { kind: 'PCT', value: 500n },
  });
  expect(resolveServiceCommissionRule(ruleLine(), [tieReset, tieExplicit])).toEqual({
    kind: 'PCT',
    value: 1000n,
  });
  expect(resolveServiceCommissionRule(ruleLine(), [tieExplicit, tieReset])).toEqual({
    kind: 'PCT',
    value: 1000n,
  });
});

it('a future reset and another employee or service never apply', () => {
  const older = override({ id: 'override-old', createdAt: 1n, rule: { kind: 'PCT', value: 500n } });
  const future = override({ id: 'override-future', createdAt: 2n, effectiveFrom: '2026-10-11' });
  // إعادة التوجيه في المستقبل لا توقف التجاوز الأقدم الساري.
  expect(resolveServiceCommissionRule(ruleLine(), [older, future])).toEqual({ kind: 'PCT', value: 500n });
  const otherEmployee = override({ id: 'override-other-employee', employeeId: 'employee-b', createdAt: 2n });
  const otherService = override({ id: 'override-other-service', serviceId: 'service-b', createdAt: 2n });
  expect(resolveServiceCommissionRule(ruleLine(), [older, otherEmployee])).toEqual({ kind: 'PCT', value: 500n });
  expect(resolveServiceCommissionRule(ruleLine(), [older, otherService])).toEqual({ kind: 'PCT', value: 500n });
});

it.each([
  { kind: 'ZERO' },
  { kind: 'PCT', value: 1000n },
  { kind: 'FIXED', value: 2000n },
  { kind: 'FOLLOW_PLAN' },
] satisfies ServiceCommissionRule[])(
  'the reset returns the saved snapshot %o of that line, and each line keeps its own',
  (ruleSnapshot) => {
    const reset = override({ rule: { kind: 'FOLLOW_SERVICE' } });
    expect(resolveServiceCommissionRule(ruleLine({ ruleSnapshot }), [reset])).toEqual(ruleSnapshot);
  },
);

it.each([
  { kind: 'ZERO' },
  { kind: 'PCT', value: 500n },
  { kind: 'FIXED', value: 2000n },
  { kind: 'FOLLOW_PLAN' },
] satisfies ServiceCommissionRule[])(
  'an explicit override %o still wins over the snapshot',
  (rule) => {
    const explicit = override({ rule });
    expect(resolveServiceCommissionRule(ruleLine(), [explicit])).toEqual(rule);
  },
);

// إثبات على مستوى الأنواع: قاعدة الكتالوج ما زلت أربعة أنواع، وFOLLOW_SERVICE للتجاوزات بس.
const catalogRuleStaysFourKinds: Extract<ServiceCommissionRule['kind'], 'FOLLOW_SERVICE'> extends never
  ? true
  : never = true;
const resolverStillReturnsACatalogRule: ServiceCommissionRule = resolveServiceCommissionRule(
  ruleLine(),
  [override()],
);

it('the catalog rule type stays four kinds and the resolver still returns one of them', () => {
  expect(catalogRuleStaysFourKinds).toBe(true);
  expect(resolverStillReturnsACatalogRule).toEqual({ kind: 'PCT', value: 1000n });
});
