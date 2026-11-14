import { expect, it } from 'vitest';

import { CommissionCorrectionStepInputError } from '../errors.ts';
import {
  type CommissionCorrectionAttribution,
  computeCommissionCorrections,
} from '../commission-correction-step.ts';

import {
  ATTRIBUTION,
  BRANCH,
  frozen,
  input,
  recomputed,
  RESOLVED,
} from './commission-correction-step.fixtures.ts';

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

it('keeps an attribution with no attached branch', () => {
  const attribution: CommissionCorrectionAttribution = {
    sourceBranchId: BRANCH,
    sourceBusinessDate: '2026-10-05',
    attachedBranchIds: [],
  };
  const drafts = computeCommissionCorrections(
    input({ frozen: [frozen('line:a', 20_000n, attribution)] }),
  );
  expect(drafts[0]?.attribution).toEqual(attribution);
});

it('refuses a source whose attribution carries no branch', () => {
  expect(() =>
    computeCommissionCorrections(
      input({
        frozen: [
          {
            sourceRef: 'line:a',
            kind: 'COMMISSION',
            amount: 20_000n,
            attribution: {
              sourceBranchId: '',
              sourceBusinessDate: '2026-10-05',
              attachedBranchIds: [],
            },
          },
        ],
      }),
    ),
  ).toThrowError(expect.objectContaining({ reason: 'MISSING_ATTRIBUTION' }));
});
