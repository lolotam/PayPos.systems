import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';
import { expect, it } from 'vitest';
import type { CalcDraft, ComponentDraft, StepDraft, TiersDraft } from '../plan-draft';
import { draftFromVersion, emptyPlanDraft, toWireCandidate, type PlanDraft } from '../plan-draft';

const NOW = new Date('2026-11-20T10:00:00Z');
const ZONE = 'Asia/Kuwait';
const DATE = '2026-11-20';

function calcDraft(kind: CalcDraft['kind'], text: string): CalcDraft {
  return kind === 'PCT'
    ? { kind: 'PCT', bps: text, amount: '' }
    : { kind: 'FIXED', bps: '', amount: text };
}

function step(fromKind: StepDraft['fromKind'], fromValue: string, calc: CalcDraft): StepDraft {
  return { fromKind, fromValue, calc };
}

function tiersDraft(partial: Partial<TiersDraft>): TiersDraft {
  return {
    enabled: false,
    touched: false,
    mode: 'MARGINAL',
    accumulator: 'AMOUNT',
    steps: [],
    ...partial,
  };
}

function draft(partial: {
  base?: ComponentDraft;
  tiers?: TiersDraft;
  packageSale?: ComponentDraft;
  effectiveFrom?: string;
}): PlanDraft {
  return {
    effectiveFrom: partial.effectiveFrom ?? DATE,
    wholePeriod: false,
    base: partial.base ?? { enabled: false, calc: calcDraft('PCT', '') },
    tiers: partial.tiers ?? tiersDraft({}),
    packageSale: partial.packageSale ?? { enabled: false, calc: calcDraft('PCT', '') },
  };
}

function errorCodes(result: ReturnType<typeof toWireCandidate>): string[] {
  return result.errors.map((error) => error.code);
}

it('starts an empty draft with the business-day date and every block off', () => {
  const value = emptyPlanDraft(ZONE, NOW);
  expect(value).toEqual({
    effectiveFrom: DATE,
    wholePeriod: false,
    base: { enabled: false, calc: { kind: 'PCT', bps: '', amount: '' } },
    tiers: { enabled: false, touched: false, mode: 'MARGINAL', accumulator: 'AMOUNT', steps: [] },
    packageSale: { enabled: false, calc: { kind: 'PCT', bps: '', amount: '' } },
  });
});

it.each([
  ['500', 500],
  ['0', 0],
  ['10000', 10000],
  ['٥٠٠', 500],
])('reads the basis-points text %s as %i', (text, expected) => {
  const result = toWireCandidate(draft({ base: { enabled: true, calc: calcDraft('PCT', text) } }));
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    base: { enabled: true, calc: { kind: 'PCT', bps: expected } },
  });
});

it.each(['-1', '12.5', 'abc', '', '100000'])('refuses the basis-points text %s', (text) => {
  const result = toWireCandidate(draft({ base: { enabled: true, calc: calcDraft('PCT', text) } }));
  expect(errorCodes(result)).toContain('INVALID_BPS');
});

it.each([
  ['1.25', '1.250'],
  ['1.250', '1.250'],
  ['3000', '3000.000'],
  ['٥٠٠', '500.000'],
])('reads the KWD text %s as %s', (text, expected) => {
  const result = toWireCandidate(
    draft({ base: { enabled: true, calc: calcDraft('FIXED', text) } }),
  );
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    base: { enabled: true, calc: { kind: 'FIXED', amount: expected } },
  });
});

it.each(['abc', '1.2.3', ''])('refuses the KWD text %s', (text) => {
  const result = toWireCandidate(
    draft({ base: { enabled: true, calc: calcDraft('FIXED', text) } }),
  );
  expect(errorCodes(result)).toContain('INVALID_MONEY');
});

it.each([
  ['4', 4],
  ['0', 0],
  ['٤', 4],
])('reads the sessions text %s as %i', (text, expected) => {
  const value = draft({
    tiers: tiersDraft({
      enabled: true,
      accumulator: 'SESSIONS',
      steps: [step('SESSIONS', text, calcDraft('PCT', '100'))],
    }),
  });
  const result = toWireCandidate(value);
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({ tiers: { steps: [{ from: { value: expected } }] } });
});

it.each(['4.5', '-2', 'abc'])('refuses the sessions text %s', (text) => {
  const value = draft({
    tiers: tiersDraft({
      enabled: true,
      accumulator: 'SESSIONS',
      steps: [step('SESSIONS', text, calcDraft('PCT', '100'))],
    }),
  });
  expect(errorCodes(toWireCandidate(value))).toContain('INVALID_SESSIONS');
});

it.each([
  ['2.5', '2.50'],
  ['2.00', '2.00'],
  ['2', '2.00'],
  ['9999.99', '9999.99'],
  ['٢٥', '25.00'],
])('reads the salary-multiple text %s as %s', (text, expected) => {
  const value = draft({
    tiers: tiersDraft({
      enabled: true,
      steps: [step('SALARY_MULTIPLE', text, calcDraft('PCT', '100'))],
    }),
  });
  const result = toWireCandidate(value);
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({ tiers: { steps: [{ from: { value: expected } }] } });
});

// الفاصلة العشرية العربية ٫ مش مقبولة زي بقية الأرقام؛ الرسالة بطلب 2.00 صراحة.
it.each(['10000.00', '2.123', '2.5.0', '٢٫٥'])('refuses the salary-multiple text %s', (text) => {
  const value = draft({
    tiers: tiersDraft({
      enabled: true,
      steps: [step('SALARY_MULTIPLE', text, calcDraft('PCT', '100'))],
    }),
  });
  expect(errorCodes(toWireCandidate(value))).toContain('INVALID_MULTIPLE');
});

it.each(['2026-11-20', '2026-01-01'])('accepts the date text %s', (text) => {
  expect(toWireCandidate(draft({ effectiveFrom: text })).errors).toEqual([]);
});

it.each(['2026-1-5', '20-11-2026', '', 'abc'])('refuses the date text %s', (text) => {
  const result = toWireCandidate(draft({ effectiveFrom: text }));
  expect(errorCodes(result)).toContain('INVALID_DATE');
  expect(result.errors[0]).toMatchObject({ block: 'effectiveFrom', code: 'INVALID_DATE' });
});

it('sends a disabled empty component as enabled false only', () => {
  const result = toWireCandidate(draft({}));
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    base: { enabled: false },
    package_sale: { enabled: false },
  });
  expect(result.candidate).not.toMatchObject({ base: { calc: { bps: 0 } } });
});

it('keeps the calc of a disabled filled component', () => {
  const result = toWireCandidate(
    draft({ base: { enabled: false, calc: calcDraft('FIXED', '2.500') } }),
  );
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    base: { enabled: false, calc: { kind: 'FIXED', amount: '2.500' } },
  });
});

it('drops the unreadable retained calc of a disabled component with no reading error', () => {
  const result = toWireCandidate(
    draft({ base: { enabled: false, calc: calcDraft('PCT', 'abc') } }),
  );
  expect(result.errors).toEqual([]);
  expect(result.candidate).toEqual({
    effective_from: DATE,
    whole_period: false,
    base: { enabled: false },
    tiers: { enabled: false },
    package_sale: { enabled: false },
  });
});

it('keeps the readable steps of disabled touched tiers and drops the unreadable ones silently', () => {
  const result = toWireCandidate(
    draft({
      tiers: tiersDraft({
        touched: true,
        steps: [
          step('AMOUNT', '10.000', calcDraft('PCT', '100')),
          step('AMOUNT', 'oops', calcDraft('PCT', 'abc')),
        ],
      }),
    }),
  );
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    tiers: {
      enabled: false,
      mode: 'MARGINAL',
      accumulator: 'AMOUNT',
      steps: [{ from: { kind: 'AMOUNT', value: '10.000' }, calc: { kind: 'PCT', bps: 100 } }],
    },
  });
});

it('sends untouched off tiers as enabled false only and keeps touched off tiers', () => {
  const untouched = toWireCandidate(draft({}));
  expect(untouched.errors).toEqual([]);
  expect(untouched.candidate).toMatchObject({ tiers: { enabled: false } });

  const touched = draft({
    tiers: tiersDraft({
      touched: true,
      mode: 'WHOLE',
      accumulator: 'SESSIONS',
      steps: [step('SESSIONS', '3', calcDraft('FIXED', '0.500'))],
    }),
  });
  const result = toWireCandidate(touched);
  expect(result.errors).toEqual([]);
  expect(result.candidate).toMatchObject({
    tiers: {
      enabled: false,
      mode: 'WHOLE',
      accumulator: 'SESSIONS',
      steps: [{ from: { kind: 'SESSIONS', value: 3 }, calc: { kind: 'FIXED', amount: '0.500' } }],
    },
  });
});

it('round-trips a stored version through draftFromVersion and back unchanged', () => {
  const stored: CreateCommissionPlanVersionInput = {
    effective_from: '2026-12-01',
    whole_period: true,
    base: { enabled: true, calc: { kind: 'FIXED', amount: '1.250' } },
    tiers: {
      enabled: false,
      mode: 'WHOLE',
      accumulator: 'AMOUNT',
      steps: [{ from: { kind: 'AMOUNT', value: '500.000' }, calc: { kind: 'PCT', bps: 250 } }],
    },
    package_sale: { enabled: true, calc: { kind: 'PCT', bps: 100 } },
  };
  const result = toWireCandidate(draftFromVersion(stored));
  expect(result.errors).toEqual([]);
  expect(result.candidate).toEqual(stored);
});

it('round-trips a version whose disabled tiers kept no settings', () => {
  const stored: CreateCommissionPlanVersionInput = {
    effective_from: '2026-12-01',
    whole_period: false,
    base: { enabled: false },
    tiers: { enabled: false },
    package_sale: { enabled: false, calc: { kind: 'FIXED', amount: '0.750' } },
  };
  const rebuilt = toWireCandidate(draftFromVersion(stored));
  expect(rebuilt.errors).toEqual([]);
  expect(rebuilt.candidate).toEqual(stored);
});
