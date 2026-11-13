import { expect, it } from 'vitest';

import { CommissionCorrectionStepInputError } from '../errors.ts';

import {
  computeCommissionCorrections,
  type CommissionCorrectionAttribution,
  type CommissionCorrectionStepInput,
  type CommissionFrozenSource,
  type CommissionPostedCorrection,
  type CommissionRecomputedSource,
} from '../commission-correction-step.ts';

const EMPLOYEE = '01990000-0000-7000-8000-0000000000c1';
const TARGET_STATEMENT = '01990000-0000-7000-8000-0000000000d1';
const EVENT = '01990000-0000-7000-8000-0000000000e1';
const BRANCH = '01990000-0000-7000-8000-0000000000b1';

const ATTRIBUTION: CommissionCorrectionAttribution = {
  sourceBranchId: BRANCH,
  sourceBusinessDate: '2026-10-05',
  attachedBranchIds: [BRANCH],
};

const RESOLVED: CommissionCorrectionAttribution = {
  sourceBranchId: '01990000-0000-7000-8000-0000000000b2',
  sourceBusinessDate: '2026-10-20',
  attachedBranchIds: ['01990000-0000-7000-8000-0000000000b2'],
};

const input = (
  overrides: Partial<CommissionCorrectionStepInput> = {},
): CommissionCorrectionStepInput => ({
  sourcePeriod: '2026-10',
  employeeId: EMPLOYEE,
  generation: 1,
  targetPeriod: '2026-11',
  targetStatementId: TARGET_STATEMENT,
  eventId: EVENT,
  frozen: [],
  posted: [],
  recomputed: [],
  ...overrides,
});

const frozen = (
  sourceRef: string,
  amount: bigint,
  attribution: CommissionCorrectionAttribution = ATTRIBUTION,
): CommissionFrozenSource => ({ sourceRef, kind: 'COMMISSION', amount, attribution });

const posted = (sourceRef: string, amount: bigint): CommissionPostedCorrection => ({
  sourceRef,
  kind: 'COMMISSION',
  amount,
});

const recomputed = (
  sourceRef: string,
  amount: bigint,
  attribution?: CommissionCorrectionAttribution,
): CommissionRecomputedSource => ({
  sourceRef,
  kind: 'COMMISSION',
  amount,
  ...(attribution === undefined ? {} : { attribution }),
});

it('posts nothing when the recompute repeats the frozen amount', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:a', 20_000n)],
      recomputed: [recomputed('line:a', 20_000n)],
    }),
  );
  expect(drafts).toEqual([]);
});

it('posts nothing when the three source sets are empty', () => {
  expect(computeCommissionCorrections(input())).toEqual([]);
});

it('posts the whole frozen amount on the first correction after the month closed', () => {
  const drafts = computeCommissionCorrections(input({ frozen: [frozen('line:a', 20_000n)] }));
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    employeeId: EMPLOYEE,
    sourcePeriod: '2026-10',
    targetPeriod: '2026-11',
    targetStatementId: TARGET_STATEMENT,
    sourceRef: 'line:a',
    kind: 'COMMISSION',
    previousAmount: 20_000n,
    newAmount: 0n,
    amount: -20_000n,
    generation: 1,
    eventId: EVENT,
    attribution: ATTRIBUTION,
  });
});

it('posts only the new difference after an earlier correction of the same source', () => {
  const drafts = computeCommissionCorrections(
    input({
      generation: 2,
      frozen: [frozen('line:a', 20_000n)],
      posted: [posted('line:a', -20_000n)],
      recomputed: [recomputed('line:a', 5_000n)],
    }),
  );
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    previousAmount: 0n,
    newAmount: 5_000n,
    amount: 5_000n,
    generation: 2,
  });
});

it('sums the corrections already posted for the same source', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:a', 20_000n)],
      posted: [posted('line:a', -20_000n), posted('line:a', 5_000n)],
    }),
  );
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({ previousAmount: 5_000n, newAmount: 0n, amount: -5_000n });
});

it('drops a source the recompute no longer carries to zero', () => {
  const drafts = computeCommissionCorrections(input({ frozen: [frozen('line:a', 12_000n)] }));
  expect(drafts[0]).toMatchObject({ previousAmount: 12_000n, newAmount: 0n, amount: -12_000n });
});

it('uses the resolved attribution for a source that was never frozen', () => {
  const drafts = computeCommissionCorrections(
    input({ recomputed: [recomputed('line:late', 20_000n, RESOLVED)] }),
  );
  expect(drafts[0]).toMatchObject({ previousAmount: 0n, newAmount: 20_000n, amount: 20_000n });
  expect(drafts[0]?.attribution).toEqual(RESOLVED);
});

it('copies the attribution from the frozen row even when a resolved one is supplied', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:a', 20_000n)],
      recomputed: [recomputed('line:a', 25_000n, RESOLVED)],
    }),
  );
  expect(drafts[0]?.attribution).toEqual(ATTRIBUTION);
});

it('copies the attribution an earlier correction already resolved', () => {
  const drafts = computeCommissionCorrections(
    input({
      posted: [
        { sourceRef: 'line:late', kind: 'COMMISSION', amount: 20_000n, attribution: RESOLVED },
      ],
    }),
  );
  expect(drafts[0]?.attribution).toEqual(RESOLVED);
  expect(drafts[0]?.amount).toBe(-20_000n);
});

it('refuses a source with no attribution at all', () => {
  expect(() =>
    computeCommissionCorrections(input({ recomputed: [recomputed('line:a', 20_000n)] })),
  ).toThrowError(CommissionCorrectionStepInputError);
  expect(() =>
    computeCommissionCorrections(input({ recomputed: [recomputed('line:a', 20_000n)] })),
  ).toThrowError(expect.objectContaining({ reason: 'MISSING_ATTRIBUTION' }));
});

it('keeps the same source ref with another kind apart', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [
        { sourceRef: 'tip:s1:CARD', kind: 'TIP_CARD', amount: 5_000n, attribution: ATTRIBUTION },
      ],
      recomputed: [
        { sourceRef: 'tip:s1:CARD', kind: 'TIP_CASH', amount: 3_000n, attribution: RESOLVED },
      ],
    }),
  );
  expect(
    drafts.map((draft) => [draft.kind, draft.previousAmount, draft.newAmount, draft.amount]),
  ).toEqual([
    ['TIP_CARD', 5_000n, 0n, -5_000n],
    ['TIP_CASH', 0n, 3_000n, 3_000n],
  ]);
});

it('CM-43: cancelling A posts -20.000 for B and the late 600 posts +20.000', () => {
  const frozenRows = [frozen('line:a', 20_000n)];
  const firstGeneration = computeCommissionCorrections(input({ frozen: frozenRows }));
  expect(firstGeneration.map((draft) => [draft.sourceRef, draft.amount])).toEqual([
    ['line:a', -20_000n],
  ]);

  const secondGeneration = computeCommissionCorrections(
    input({
      generation: 2,
      frozen: frozenRows,
      posted: [posted('line:a', -20_000n)],
      recomputed: [recomputed('line:late-600', 20_000n, RESOLVED)],
    }),
  );
  expect(secondGeneration.map((draft) => [draft.sourceRef, draft.amount])).toEqual([
    ['line:late-600', 20_000n],
  ]);
});

it('CM-44: the cancelled 200.000 line posts -10.000 into November at generation 1', () => {
  const frozenRows = [frozen('line:200', 10_000n)];
  const drafts = computeCommissionCorrections(input({ frozen: frozenRows }));
  expect(drafts).toHaveLength(1);
  expect(drafts[0]).toMatchObject({
    targetPeriod: '2026-11',
    generation: 1,
    previousAmount: 10_000n,
    newAmount: 0n,
    amount: -10_000n,
  });
  expect(frozenRows).toEqual([
    { sourceRef: 'line:200', kind: 'COMMISSION', amount: 10_000n, attribution: ATTRIBUTION },
  ]);
});

it('rejects a duplicate frozen source', () => {
  expect(() =>
    computeCommissionCorrections(input({ frozen: [frozen('line:a', 1n), frozen('line:a', 2n)] })),
  ).toThrowError(expect.objectContaining({ reason: 'DUPLICATE_SOURCE' }));
});

it('rejects a duplicate recomputed source', () => {
  expect(() =>
    computeCommissionCorrections(
      input({ recomputed: [recomputed('line:a', 1n), recomputed('line:a', 2n)] }),
    ),
  ).toThrowError(expect.objectContaining({ reason: 'DUPLICATE_SOURCE' }));
});

it('orders the drafts by source ref then kind whatever the input order', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:c', 1_000n), frozen('line:a', 2_000n), frozen('line:b', 3_000n)],
    }),
  );
  expect(drafts.map((draft) => draft.sourceRef)).toEqual(['line:a', 'line:b', 'line:c']);
});

it('keeps a negative amount signed', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:refund', -5_000n)],
      recomputed: [recomputed('line:refund', -1_000n)],
    }),
  );
  expect(drafts[0]).toMatchObject({
    previousAmount: -5_000n,
    newAmount: -1_000n,
    amount: 4_000n,
  });
});

it('carries an amount at the top of the numeric(14,3) range', () => {
  const drafts = computeCommissionCorrections(
    input({ frozen: [frozen('line:big', 99_999_999_999_999n)] }),
  );
  expect(drafts[0]).toMatchObject({
    previousAmount: 99_999_999_999_999n,
    newAmount: 0n,
    amount: -99_999_999_999_999n,
  });
});

it('keeps the mills exact where a float would drift', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:exact', 33_333_333_333_333n)],
      posted: [posted('line:exact', 33_333_333_333_334n)],
    }),
  );
  expect(drafts[0]).toMatchObject({
    previousAmount: 66_666_666_666_667n,
    newAmount: 0n,
    amount: -66_666_666_666_667n,
  });
});

it('does not touch the rows it reads', () => {
  const rows = [frozen('line:a', 20_000n)];
  computeCommissionCorrections(input({ frozen: rows }));
  expect(rows).toEqual([
    { sourceRef: 'line:a', kind: 'COMMISSION', amount: 20_000n, attribution: ATTRIBUTION },
  ]);
});
