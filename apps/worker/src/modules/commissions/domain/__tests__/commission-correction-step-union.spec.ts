import { expect, it } from 'vitest';

import { computeCommissionCorrections } from '../commission-correction-step.ts';

import {
  ATTRIBUTION,
  EMPLOYEE,
  EVENT,
  frozen,
  input,
  posted,
  recomputed,
  RESOLVED,
  TARGET_STATEMENT,
} from './commission-correction-step.fixtures.ts';

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

it('orders the drafts by source ref whatever the input order', () => {
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

it('does not touch the rows it reads', () => {
  const rows = [frozen('line:a', 20_000n)];
  computeCommissionCorrections(input({ frozen: rows }));
  expect(rows).toEqual([
    { sourceRef: 'line:a', kind: 'COMMISSION', amount: 20_000n, attribution: ATTRIBUTION },
  ]);
});
