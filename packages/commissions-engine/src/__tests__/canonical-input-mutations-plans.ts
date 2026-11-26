import type { CommissionPlanVersion } from '../plan-types.ts';
import { edit, type FieldMutation, type MutationExtra } from './canonical-input-mutation-editor.ts';
import { PERIOD } from './statement-fixtures.ts';

const SARA_VERSION = 0;
const NOOR_VERSION = 3;
const V = 'employees[].versions[].';
const FIRST_STEP = {
  from: { kind: 'AMOUNT', value: 100_000n },
  calc: { kind: 'PCT', value: 500n },
} as const;
const SECOND_STEP = {
  from: { kind: 'AMOUNT', value: 200_000n },
  calc: { kind: 'FIXED', value: 3_000n },
} as const;
const STEP_LEAVES = [0, 1].flatMap((step) =>
  ['from.kind', 'from.value', 'calc.kind', 'calc.value'].map(
    (leaf) => `tiers.steps[${step}].${leaf}`,
  ),
);

/**
 * تعديل شرائح إصدار نور بتعديل واحد.
 *
 * @param field مسار الورقة العام
 * @param change الحقل أو الحقول اللي بتتغير في الشرائح
 * @param extra الأوراق اللي بتتغير حتماً مع الحقل، وهوية الخطوة
 * @returns التعديل
 */
function noorTiers(
  field: string,
  change: Record<string, unknown>,
  extra: MutationExtra = {},
): FieldMutation {
  const tiers = {
    enabled: true,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [FIRST_STEP, SECOND_STEP],
    ...change,
  };
  return edit(field, 'versions', NOOR_VERSION, { tiers } as Partial<CommissionPlanVersion>, extra);
}

/**
 * تعديلات إصدار سارة الأول: تواريخه وعلاماته وبيع الباقة.
 *
 * @returns التعديلات
 */
export function saraPlanMutations(): FieldMutation[] {
  const p = (field: string, change: Partial<CommissionPlanVersion>, extra: MutationExtra = {}) =>
    edit(`${V}${field}`, 'versions', SARA_VERSION, change, extra);
  const sale = ['package_sale.calc.kind', 'package_sale.calc.value'];
  return [
    p('version', { version: 2n }),
    p('effective_from', { effectiveFrom: '2026-09-30' }),
    p('whole_period', { wholePeriod: true }),
    p('repair_period', { repairPeriod: PERIOD }),
    p('created_at', { createdAt: 1_789_000_000_000_002n }),
    p('package_sale.enabled', { packageSale: { enabled: false } }, { alsoChanges: sale }),
    p(
      'package_sale.calc.kind',
      { packageSale: { enabled: true, calc: { kind: 'FIXED', value: 1_000n } } },
      { alsoChanges: ['package_sale.calc.value'] },
    ),
    p('package_sale.calc.value', {
      packageSale: { enabled: true, calc: { kind: 'PCT', value: 1_001n } },
    }),
  ];
}

/**
 * تعديلات إصدار نور: الأساسي والشرائح بخطوتيها.
 *
 * @returns التعديلات
 */
export function noorPlanMutations(): FieldMutation[] {
  const n = (field: string, change: Partial<CommissionPlanVersion>, extra: MutationExtra = {}) =>
    edit(`${V}${field}`, 'versions', NOOR_VERSION, change, extra);
  const step = { stepIds: ['0'] };
  return [
    n(
      'base.enabled',
      { base: { enabled: false } },
      { alsoChanges: ['base.calc.kind', 'base.calc.value'] },
    ),
    n(
      'base.calc.kind',
      { base: { enabled: true, calc: { kind: 'FIXED', value: 300n } } },
      { alsoChanges: ['base.calc.value'] },
    ),
    n('base.calc.value', { base: { enabled: true, calc: { kind: 'PCT', value: 301n } } }),
    n(
      'tiers.enabled',
      { tiers: { enabled: false } },
      { alsoChanges: ['tiers.mode', 'tiers.accumulator', ...STEP_LEAVES] },
    ),
    noorTiers(`${V}tiers.mode`, { mode: 'WHOLE' }),
    noorTiers(`${V}tiers.accumulator`, { accumulator: 'SESSIONS' }),
    noorTiers(
      `${V}tiers.steps[].from.kind`,
      { steps: [{ ...FIRST_STEP, from: { kind: 'SESSIONS', value: 100_000n } }, SECOND_STEP] },
      { ...step, alsoChanges: ['tiers.steps[0].from.value'] },
    ),
    noorTiers(
      `${V}tiers.steps[].from.value`,
      { steps: [{ ...FIRST_STEP, from: { kind: 'AMOUNT', value: 100_001n } }, SECOND_STEP] },
      step,
    ),
    noorTiers(
      `${V}tiers.steps[].calc.kind`,
      { steps: [{ ...FIRST_STEP, calc: { kind: 'FIXED', value: 500n } }, SECOND_STEP] },
      { ...step, alsoChanges: ['tiers.steps[0].calc.value'] },
    ),
    noorTiers(
      `${V}tiers.steps[].calc.value`,
      { steps: [{ ...FIRST_STEP, calc: { kind: 'PCT', value: 501n } }, SECOND_STEP] },
      step,
    ),
  ];
}
