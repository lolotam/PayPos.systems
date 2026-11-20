import { validateWireCommissionPlan } from '@pospay/commissions-engine/validation';
import {
  createCommissionPlanVersionInput,
  type CreateCommissionPlanVersionInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { ResolverResult } from 'react-hook-form';
import { expect, it } from 'vitest';
import type { CalcDraft, ComponentDraft, StepDraft, TiersDraft } from '../plan-draft';
import { emptyPlanDraft, toWireCandidate, type PlanDraft } from '../plan-draft';
import { DRAFT_ERROR_KEYS, PLAN_ERROR_KEYS } from '../plan-messages';
import { createPlanResolver } from '../plan-resolver';

const NOW = new Date('2026-11-20T10:00:00Z');
const ZONE = 'Asia/Kuwait';
const CALC_KINDS = ['PCT', 'FIXED'] as const;
const THRESHOLD_KINDS = ['AMOUNT', 'SESSIONS', 'SALARY_MULTIPLE'] as const;
const MODES = ['MARGINAL', 'WHOLE'] as const;
const ACCUMULATORS = ['AMOUNT', 'SESSIONS'] as const;
const THRESHOLD_VALUES = { AMOUNT: '10.000', SESSIONS: '5', SALARY_MULTIPLE: '2.00' } as const;

const resolve = createPlanResolver('en');

type CalcKind = (typeof CALC_KINDS)[number];
type ThresholdKind = (typeof THRESHOLD_KINDS)[number];

function calcOf(kind: CalcKind): CalcDraft {
  return kind === 'PCT'
    ? { kind: 'PCT', bps: '500', amount: '' }
    : { kind: 'FIXED', bps: '', amount: '1.000' };
}

function stepOf(kind: ThresholdKind, calcKind: CalcKind): StepDraft {
  return { fromKind: kind, fromValue: THRESHOLD_VALUES[kind], calc: calcOf(calcKind) };
}

interface Combo {
  calcKind: CalcKind;
  thresholdKind: ThresholdKind;
  mode: (typeof MODES)[number];
  accumulator: (typeof ACCUMULATORS)[number];
  base: boolean;
  tiers: boolean;
  packageSale: boolean;
}

const COMBOS = CALC_KINDS.flatMap((calcKind) =>
  THRESHOLD_KINDS.flatMap((thresholdKind) =>
    MODES.flatMap((mode) =>
      ACCUMULATORS.flatMap((accumulator) =>
        [true, false].flatMap((base) =>
          [true, false].flatMap((tiers) =>
            [true, false].map((packageSale) => ({
              calcKind,
              thresholdKind,
              mode,
              accumulator,
              base,
              tiers,
              packageSale,
            })),
          ),
        ),
      ),
    ),
  ),
);

function draftOf(combo: Combo): PlanDraft {
  const empty = emptyPlanDraft(ZONE, NOW);
  return {
    ...empty,
    base: combo.base ? { enabled: true, calc: calcOf(combo.calcKind) } : empty.base,
    tiers: combo.tiers
      ? {
          enabled: true,
          touched: true,
          mode: combo.mode,
          accumulator: combo.accumulator,
          steps: [stepOf(combo.thresholdKind, combo.calcKind)],
        }
      : empty.tiers,
    packageSale: combo.packageSale
      ? { enabled: true, calc: calcOf(combo.calcKind) }
      : empty.packageSale,
  };
}

function tiersOn(
  mode: TiersDraft['mode'],
  accumulator: TiersDraft['accumulator'],
  steps: StepDraft[],
): TiersDraft {
  return { enabled: true, touched: true, mode, accumulator, steps };
}

function edgeDraft(
  base: ComponentDraft | null,
  tiers: TiersDraft | null,
  packageSale: ComponentDraft | null,
): PlanDraft {
  const empty = emptyPlanDraft(ZONE, NOW);
  return {
    ...empty,
    base: base ?? empty.base,
    tiers: tiers ?? empty.tiers,
    packageSale: packageSale ?? empty.packageSale,
  };
}

type PlanResolverResult = ResolverResult<PlanDraft, CreateCommissionPlanVersionInput>;

function runResolver(draft: PlanDraft): PlanResolverResult {
  return resolve(draft, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  }) as PlanResolverResult;
}

function messageOf(errors: unknown, block: string): string | undefined {
  const error = (errors as Record<string, { message?: unknown }>)[block];
  return typeof error?.message === 'string' ? error.message : undefined;
}

it('agrees with the engine across the §5.7 product and reports the whole-plan code on its first block', () => {
  expect(COMBOS.length).toBe(2 * 3 * 2 * 2 * 8);
  for (const combo of COMBOS) {
    const draft = draftOf(combo);
    const built = toWireCandidate(draft);
    const result = runResolver(draft);
    const refused = Object.keys(result.errors).length > 0;
    if (built.errors.length > 0) {
      expect(refused, JSON.stringify(combo)).toBe(true);
      for (const error of built.errors) {
        expect(messageOf(result.errors, error.block), JSON.stringify(combo)).toBe(
          t('en', DRAFT_ERROR_KEYS[error.code]),
        );
      }
      continue;
    }
    const parsed = createCommissionPlanVersionInput.safeParse(built.candidate);
    expect(parsed.success, JSON.stringify(combo)).toBe(true);
    if (!parsed.success) continue;
    const engine = validateWireCommissionPlan(parsed.data);
    expect(refused, JSON.stringify(combo)).toBe(!engine.ok);
    if (engine.ok) {
      expect(result.values, JSON.stringify(combo)).toEqual(parsed.data);
      continue;
    }
    const firstBlock = ['base', 'tiers', 'packageSale']
      .map((block) => messageOf(result.errors, block))
      .find((message) => message !== undefined);
    expect(firstBlock, JSON.stringify(combo)).toBe(t('en', PLAN_ERROR_KEYS[engine.code]));
  }
});

it.each([
  [
    'mixed threshold kinds',
    tiersOn('MARGINAL', 'AMOUNT', [stepOf('AMOUNT', 'PCT'), stepOf('SESSIONS', 'PCT')]),
    'MIXED_THRESHOLDS',
  ],
  [
    'two equal steps',
    tiersOn('WHOLE', 'AMOUNT', [stepOf('AMOUNT', 'PCT'), stepOf('AMOUNT', 'PCT')]),
    'STEPS_NOT_ASCENDING',
  ],
  [
    'two descending steps',
    tiersOn('MARGINAL', 'AMOUNT', [
      stepOf('AMOUNT', 'PCT'),
      { fromKind: 'AMOUNT', fromValue: '5.000', calc: calcOf('PCT') },
    ]),
    'STEPS_NOT_ASCENDING',
  ],
  ['tiers on with no step', tiersOn('WHOLE', 'SESSIONS', []), 'NO_STEPS'],
  ['disabled blocks keeping valid settings', null, null],
] as const)('matches the engine edge by edge: %s', (_name, tiers, expectedCode) => {
  const draft =
    expectedCode === null
      ? edgeDraft(
          { enabled: false, calc: { kind: 'FIXED', bps: '', amount: '2.500' } },
          {
            enabled: false,
            touched: true,
            mode: 'WHOLE',
            accumulator: 'SESSIONS',
            steps: [stepOf('SESSIONS', 'FIXED')],
          },
          { enabled: false, calc: { kind: 'PCT', bps: '100', amount: '' } },
        )
      : edgeDraft({ enabled: true, calc: calcOf('PCT') }, tiers, null);
  const built = toWireCandidate(draft);
  const result = runResolver(draft);
  const refused = Object.keys(result.errors).length > 0;
  expect(built.errors.length).toBe(0);
  if (built.errors.length > 0) return;
  const parsed = createCommissionPlanVersionInput.safeParse(built.candidate);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const engine = validateWireCommissionPlan(parsed.data);
  if (expectedCode === null) {
    expect(engine.ok).toBe(true);
    expect(refused).toBe(false);
    expect(result.values).toEqual(parsed.data);
    return;
  }
  expect(engine).toEqual({ ok: false, code: expectedCode });
  expect(refused).toBe(true);
  const firstBlock = ['base', 'tiers', 'packageSale']
    .map((block) => messageOf(result.errors, block))
    .find((message) => message !== undefined);
  expect(firstBlock).toBe(t('en', PLAN_ERROR_KEYS[expectedCode]));
});

it.each([
  ['0', true],
  ['10000', true],
  ['10001', false],
])('matches the engine on the percentage boundary %s basis points', (text, accepted) => {
  const draft = edgeDraft(
    { enabled: true, calc: { kind: 'PCT', bps: text, amount: '' } },
    null,
    null,
  );
  const built = toWireCandidate(draft);
  const result = runResolver(draft);
  const refused = Object.keys(result.errors).length > 0;
  expect(built.errors.length).toBe(0);
  if (built.errors.length > 0) return;
  const parsed = createCommissionPlanVersionInput.safeParse(built.candidate);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const engine = validateWireCommissionPlan(parsed.data);
  expect(refused).toBe(!engine.ok);
  if (!accepted) expect(engine).toEqual({ ok: false, code: 'INVALID_CALC' });
  if (accepted) expect(result.values).toEqual(parsed.data);
});

it.each([
  ['0.00', false],
  ['0.01', true],
])('matches the engine on the salary-multiple boundary %s', (text, accepted) => {
  const draft = edgeDraft(
    null,
    tiersOn('MARGINAL', 'AMOUNT', [
      { fromKind: 'SALARY_MULTIPLE', fromValue: text, calc: calcOf('PCT') },
    ]),
    null,
  );
  const built = toWireCandidate(draft);
  const result = runResolver(draft);
  const refused = Object.keys(result.errors).length > 0;
  expect(built.errors.length).toBe(0);
  if (built.errors.length > 0) return;
  const parsed = createCommissionPlanVersionInput.safeParse(built.candidate);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const engine = validateWireCommissionPlan(parsed.data);
  expect(refused).toBe(!engine.ok);
  if (!accepted) expect(engine).toEqual({ ok: false, code: 'INVALID_THRESHOLD' });
  if (accepted) expect(result.values).toEqual(parsed.data);
});

it('reports two different blocks when base and tiers each carry a different reading error', () => {
  const draft = edgeDraft(
    { enabled: true, calc: { kind: 'PCT', bps: 'abc', amount: '' } },
    tiersOn('MARGINAL', 'AMOUNT', [
      { fromKind: 'AMOUNT', fromValue: 'wrong', calc: calcOf('PCT') },
    ]),
    null,
  );
  const result = runResolver(draft);
  expect(messageOf(result.errors, 'base')).toBe(t('en', 'commissionPlanBuilder.errorInvalidBps'));
  expect(messageOf(result.errors, 'tiers')).toBe(
    t('en', 'commissionPlanBuilder.errorInvalidMoney'),
  );
});

it('refuses a draft whose whole-period flag is not a boolean with the generic plan message on a block', () => {
  const draft = {
    ...edgeDraft({ enabled: true, calc: calcOf('PCT') }, null, null),
    wholePeriod: 'yes' as unknown as boolean,
  };
  const built = toWireCandidate(draft);
  const result = runResolver(draft);
  expect(built.errors).toEqual([]);
  expect(Object.keys(result.errors).length).toBeGreaterThan(0);
  expect(messageOf(result.errors, 'base')).toBe(t('en', 'commissionPlanBuilder.errorInvalidPlan'));
});
