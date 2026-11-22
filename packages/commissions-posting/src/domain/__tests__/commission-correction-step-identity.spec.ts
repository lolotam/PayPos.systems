import { expect, it } from 'vitest';

import { computeCommissionCorrections } from '../commission-correction-step.ts';

import {
  ATTRIBUTION,
  frozen,
  input,
  recomputed,
  RESOLVED,
} from './commission-correction-step.fixtures.ts';

it('refuses one source ref that appears under two kinds', () => {
  expect(() =>
    computeCommissionCorrections(
      input({
        frozen: [
          { sourceRef: 'tip:s1:CARD', kind: 'TIP_CARD', amount: 5_000n, attribution: ATTRIBUTION },
        ],
        recomputed: [
          { sourceRef: 'tip:s1:CARD', kind: 'TIP_CASH', amount: 3_000n, attribution: RESOLVED },
        ],
      }),
    ),
  ).toThrowError(
    expect.objectContaining({ reason: 'SOURCE_KIND_CONFLICT', sourceRef: 'tip:s1:CARD' }),
  );
});

it('refuses one source ref whose kind changes between the frozen row and a posted correction', () => {
  expect(() =>
    computeCommissionCorrections(
      input({
        frozen: [
          { sourceRef: 'line:a', kind: 'COMMISSION', amount: 5_000n, attribution: ATTRIBUTION },
        ],
        posted: [{ sourceRef: 'line:a', kind: 'SALE', amount: -5_000n }],
      }),
    ),
  ).toThrowError(expect.objectContaining({ reason: 'SOURCE_KIND_CONFLICT', sourceRef: 'line:a' }));
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
