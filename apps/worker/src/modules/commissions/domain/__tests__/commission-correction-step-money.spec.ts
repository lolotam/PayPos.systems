import { MONEY_MAX } from '@pospay/domain';
import { expect, it } from 'vitest';

import { computeCommissionCorrections } from '../commission-correction-step.ts';

import { frozen, input, posted, recomputed } from './commission-correction-step.fixtures.ts';

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

it('refuses a delta that leaves the numeric(14,3) range', () => {
  expect(() =>
    computeCommissionCorrections(
      input({
        frozen: [frozen('line:a', -MONEY_MAX)],
        recomputed: [recomputed('line:a', MONEY_MAX)],
      }),
    ),
  ).toThrowError(expect.objectContaining({ reason: 'AMOUNT_OUT_OF_RANGE', sourceRef: 'line:a' }));
});

it('refuses a recomputed amount above the numeric(14,3) range', () => {
  expect(() =>
    computeCommissionCorrections(input({ recomputed: [recomputed('line:a', MONEY_MAX + 1n)] })),
  ).toThrowError(expect.objectContaining({ reason: 'AMOUNT_OUT_OF_RANGE', sourceRef: 'line:a' }));
});

it('refuses a previous amount whose sum leaves the numeric(14,3) range', () => {
  expect(() =>
    computeCommissionCorrections(
      input({
        frozen: [frozen('line:a', MONEY_MAX)],
        posted: [posted('line:a', MONEY_MAX)],
      }),
    ),
  ).toThrowError(expect.objectContaining({ reason: 'AMOUNT_OUT_OF_RANGE', sourceRef: 'line:a' }));
});

it('accepts a delta at the exact numeric(14,3) bound', () => {
  const drafts = computeCommissionCorrections(
    input({
      frozen: [frozen('line:a', -49_999_999_999_999n)],
      recomputed: [recomputed('line:a', 50_000_000_000_000n)],
    }),
  );
  expect(drafts[0]).toMatchObject({
    previousAmount: -49_999_999_999_999n,
    newAmount: 50_000_000_000_000n,
    amount: MONEY_MAX,
  });
});
