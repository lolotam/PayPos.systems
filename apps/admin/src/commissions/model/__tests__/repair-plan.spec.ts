import { t } from '@pospay/i18n';
import type { CreateCommissionPeriodRepairInput } from '@pospay/contracts';
import type { ResolverResult } from 'react-hook-form';
import { expect, it } from 'vitest';
import {
  emptyPlanDraft,
  emptyRepairPlanDraft,
  toRepairWireCandidate,
  type RepairPlanDraft,
} from '../plan-draft';
import { PLAN_ERROR_KEYS } from '../plan-messages';
import { createRepairPlanResolver } from '../plan-resolver';

type RepairPlan = CreateCommissionPeriodRepairInput['plan'];
const resolve = createRepairPlanResolver('en');

function run(draft: RepairPlanDraft): ResolverResult<RepairPlanDraft, RepairPlan> {
  return resolve(draft, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  }) as ResolverResult<RepairPlanDraft, RepairPlan>;
}

function messageOf(errors: unknown, block: string): string | undefined {
  const error = (errors as Record<string, { message?: unknown }>)[block];
  return typeof error?.message === 'string' ? error.message : undefined;
}

const percent = (bps: string) => ({ enabled: true, calc: { kind: 'PCT' as const, bps, amount: '' } });

it('starts an empty repair draft with the three blocks off and no date fields', () => {
  const draft = emptyRepairPlanDraft();
  expect(Object.keys(draft).sort()).toEqual(['base', 'packageSale', 'tiers']);
  expect(draft.base.enabled || draft.tiers.enabled || draft.packageSale.enabled).toBe(false);
  expect(emptyPlanDraft('Asia/Kuwait', new Date('2026-11-20T10:00:00Z'))).toMatchObject(draft);
});

it('builds a repair candidate from the three blocks only, without an effective date or whole period', () => {
  const built = toRepairWireCandidate({ ...emptyRepairPlanDraft(), base: percent('500') });
  expect(built.errors).toEqual([]);
  expect(Object.keys(built.candidate as object).sort()).toEqual(['base', 'package_sale', 'tiers']);
  expect(built.candidate).toMatchObject({ base: { enabled: true, calc: { kind: 'PCT', bps: 500 } } });
});

it('flags a malformed percentage on its own block, like the ordinary builder', () => {
  const built = toRepairWireCandidate({ ...emptyRepairPlanDraft(), base: percent('abc') });
  expect(built.errors).toEqual([{ block: 'base', code: 'INVALID_BPS' }]);
});

it('accepts a valid repair plan and hands the contract body to the form', () => {
  const result = run({ ...emptyRepairPlanDraft(), base: percent('1000') });
  expect(result.errors).toEqual({});
  expect(result.values).toMatchObject({ base: { enabled: true, calc: { kind: 'PCT', bps: 1000 } } });
});

it('refuses a reading error on its block with the same message as the ordinary builder', () => {
  const result = run({ ...emptyRepairPlanDraft(), packageSale: percent('x') });
  expect(messageOf(result.errors, 'packageSale')).toBe(t('en', 'commissionPlanBuilder.errorInvalidBps'));
});

it('refuses with the engine message when an enabled tiers block has no step', () => {
  const draft = emptyRepairPlanDraft();
  const result = run({
    ...draft,
    tiers: { ...draft.tiers, enabled: true, touched: true, steps: [] },
  });
  expect(messageOf(result.errors, 'tiers')).toBe(t('en', PLAN_ERROR_KEYS.NO_STEPS));
});

it('refuses a percentage above 10000 basis points', () => {
  const result = run({ ...emptyRepairPlanDraft(), base: percent('10001') });
  expect(messageOf(result.errors, 'base')).toBeTruthy();
  expect(result.values).toEqual({});
});
