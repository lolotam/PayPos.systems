import { expect, it } from 'vitest';

import type {
  CommissionRuleLine,
  ServiceCommissionOverride,
  ServiceCommissionRule,
} from '../commission-types.ts';
import { resolveServiceCommissionRule } from '../service-rule.ts';

const line = Object.freeze({
  employeeId: 'employee-a',
  serviceId: 'service-a',
  businessDate: '2026-10-10',
  ruleSnapshot: { kind: 'FOLLOW_PLAN' },
} satisfies CommissionRuleLine);
const override = (patch: Partial<ServiceCommissionOverride> = {}): ServiceCommissionOverride => ({
  id: 'override-a',
  employeeId: 'employee-a',
  serviceId: 'service-a',
  effectiveFrom: '2026-10-01',
  createdAt: 1n,
  rule: { kind: 'ZERO' },
  ...patch,
});

it.each([
  ['absent', []],
  ['another employee', [override({ employeeId: 'employee-b' })]],
  ['another service', [override({ serviceId: 'service-b' })]],
  ['future business date', [override({ effectiveFrom: '2026-10-11' })]],
] as const)('CE1-RULE %s falls back to snapshot, never silent ZERO', (_name, overrides) => {
  expect(resolveServiceCommissionRule(line, overrides)).toEqual({ kind: 'FOLLOW_PLAN' });
});

it.each([
  { kind: 'ZERO' },
  { kind: 'FOLLOW_PLAN' },
  { kind: 'PCT', value: 500n },
  { kind: 'FIXED', value: 2000n },
] satisfies ServiceCommissionRule[])(
  'CE1-RULE applies %o on the inclusive business date',
  (rule) => {
    expect(
      resolveServiceCommissionRule(line, [override({ effectiveFrom: line.businessDate, rule })]),
    ).toEqual(rule);
  },
);

it('CE1-RULE ranks by createdAt then id, not latest effectiveFrom or input order', () => {
  const winner = override({ id: 'override-z', createdAt: 3n, rule: { kind: 'PCT', value: 500n } });
  const overrides = Object.freeze([
    Object.freeze(override({ effectiveFrom: '2026-10-10', createdAt: 2n })),
    Object.freeze(winner),
    Object.freeze(override({ id: 'override-b', createdAt: 3n })),
    Object.freeze(override({ id: 'override-zz', createdAt: 4n, effectiveFrom: '2026-10-11' })),
  ]);
  expect(resolveServiceCommissionRule(line, overrides)).toEqual(winner.rule);
  expect(resolveServiceCommissionRule(line, [...overrides].reverse())).toEqual(winner.rule);
});

it.each([
  { kind: 'ZERO' },
  { kind: 'PCT', value: 1000n },
  { kind: 'FIXED', value: 1000n },
] satisfies ServiceCommissionRule[])(
  'CE1-RULE preserves snapshot %o when no override applies',
  (ruleSnapshot) => {
    expect(resolveServiceCommissionRule({ ...line, ruleSnapshot }, [])).toEqual(ruleSnapshot);
  },
);

it('CE1-RULE uses the already-resolved Kuwait date at a UTC day boundary', () => {
  // 2026-10-09T21:30Z يقع في يوم 10 أكتوبر بالكويت؛ تسوية التاريخ تتم قبل دخول المحرك.
  const local = override({ effectiveFrom: '2026-10-10' });
  expect(resolveServiceCommissionRule(line, [local])).toEqual({ kind: 'ZERO' });
  expect(resolveServiceCommissionRule({ ...line, businessDate: '2026-10-09' }, [local])).toEqual({
    kind: 'FOLLOW_PLAN',
  });
});
