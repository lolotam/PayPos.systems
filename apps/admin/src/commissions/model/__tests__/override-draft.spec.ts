import { expect, it } from 'vitest';
import type { CommissionOverrideServiceCurrentOverride } from '@pospay/contracts';
import {
  overrideDraft,
  toOverrideBody,
  type OverrideDraft,
  type OverrideKind,
} from '../override-draft';

const SERVICE = '01920000-0000-7000-8000-0000000000b3';

function draft(overrides: Partial<OverrideDraft> = {}): OverrideDraft {
  return { kind: 'PCT', bps: '', amount: '', effectiveFrom: '2026-03-01', ...overrides };
}

function accepted(body: OverrideDraft) {
  const result = toOverrideBody(body, SERVICE);
  expect(result.errors).toEqual([]);
  expect(result.parsed.success).toBe(true);
  if (!result.parsed.success) throw new Error('expected an accepted body');
  return result.parsed.data;
}

function refused(body: OverrideDraft) {
  const result = toOverrideBody(body, SERVICE);
  expect(result.parsed.success).toBe(false);
  return result.errors;
}

it('builds the exact wire body for each of the four rule kinds', () => {
  const kinds: [OverrideDraft, object][] = [
    [draft({ kind: 'FOLLOW_PLAN' }), { kind: 'FOLLOW_PLAN' }],
    [draft({ kind: 'ZERO' }), { kind: 'ZERO' }],
    [draft({ kind: 'PCT', bps: '1500' }), { kind: 'PCT', value: 1500 }],
    [draft({ kind: 'FIXED', amount: '12.500' }), { kind: 'FIXED', value: '12.500' }],
  ];
  for (const [body, rule] of kinds)
    expect(accepted(body)).toEqual({ service_id: SERVICE, rule, effective_from: '2026-03-01' });
});

it('takes the percentage boundaries the contract allows and refuses the ones above it', () => {
  expect(accepted(draft({ kind: 'PCT', bps: '0' })).rule).toEqual({ kind: 'PCT', value: 0 });
  expect(accepted(draft({ kind: 'PCT', bps: '10000' })).rule).toEqual({
    kind: 'PCT',
    value: 10_000,
  });
  expect(refused(draft({ kind: 'PCT', bps: '10001' }))).toEqual([
    { field: 'bps', code: 'INVALID_BPS' },
  ]);
  expect(refused(draft({ kind: 'PCT', bps: '1e3' }))).toEqual([
    { field: 'bps', code: 'INVALID_BPS' },
  ]);
});

it('normalises the fixed amount to three decimals and reads Arabic digits', () => {
  expect(accepted(draft({ kind: 'FIXED', amount: '12.5' })).rule).toEqual({
    kind: 'FIXED',
    value: '12.500',
  });
  expect(accepted(draft({ kind: 'FIXED', amount: '١٢.٥' })).rule).toEqual({
    kind: 'FIXED',
    value: '12.500',
  });
  expect(refused(draft({ kind: 'FIXED', amount: '-1.000' }))).toEqual([
    { field: 'amount', code: 'INVALID_MONEY' },
  ]);
  expect(refused(draft({ kind: 'FIXED', amount: '123456789012.000' }))).toEqual([
    { field: 'amount', code: 'INVALID_MONEY' },
  ]);
});

it('refuses a date the contract will not take', () => {
  expect(refused(draft({ kind: 'ZERO', effectiveFrom: '2026-13-45' }))).toEqual([
    { field: 'effectiveFrom', code: 'INVALID_DATE' },
  ]);
  expect(refused(draft({ kind: 'ZERO', effectiveFrom: 'not-a-date' }))).toEqual([
    { field: 'effectiveFrom', code: 'INVALID_DATE' },
  ]);
  expect(refused(draft({ kind: 'ZERO', effectiveFrom: '0000-01-01' }))).toEqual([
    { field: 'effectiveFrom', code: 'INVALID_DATE' },
  ]);
});

it('has exactly the four rule kinds the contract defines', () => {
  type ExpectedKinds = 'FOLLOW_PLAN' | 'ZERO' | 'PCT' | 'FIXED';
  const exact: ExpectedKinds extends OverrideKind
    ? OverrideKind extends ExpectedKinds
      ? true
      : false
    : false = true;
  expect(exact).toBe(true);
});

it('starts a row without an override from an empty percentage on the business day', () => {
  expect(overrideDraft(null, 'Asia/Kuwait', new Date('2026-03-01T22:30:00Z'))).toEqual({
    kind: 'PCT',
    bps: '',
    amount: '',
    effectiveFrom: '2026-03-02',
  });
});

it('starts a row with an override from that override but keeps the business day', () => {
  const current: CommissionOverrideServiceCurrentOverride = {
    id: '01920000-0000-7000-8000-0000000000d1',
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-01-05',
    created_at: '2026-01-05T09:00:00Z',
  };
  const fixed: CommissionOverrideServiceCurrentOverride = {
    ...current,
    rule: { kind: 'FIXED', value: '12.500' },
  };
  expect(overrideDraft(current, 'Asia/Kuwait', new Date('2026-03-01T22:30:00Z'))).toEqual({
    kind: 'PCT',
    bps: '1500',
    amount: '',
    effectiveFrom: '2026-03-02',
  });
  expect(overrideDraft(fixed, 'Asia/Kuwait', new Date('2026-03-01T22:30:00Z'))).toEqual({
    kind: 'FIXED',
    bps: '',
    amount: '12.500',
    effectiveFrom: '2026-03-02',
  });
});
