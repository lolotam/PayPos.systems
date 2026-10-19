import { describe, expect, it } from 'vitest';

import { performerNetWeights, suggestTipSplit } from '../tip-split.js';

const ada = '01920000-0000-7000-8000-000000000006';
const bea = '01920000-0000-7000-8000-000000000007';

describe('suggestTipSplit', () => {
  it('splits 8.000 by net weights 6 and 2 without dropping a mill', () => {
    const weights = performerNetWeights([
      {
        status: 'ACTIVE',
        net: 8_000n,
        performers: [
          { employee_id: ada, share_bps: 7500 },
          { employee_id: bea, share_bps: 2500 },
        ],
      },
    ]);
    expect(weights).toEqual([
      { employee_id: ada, weight: 6_000n },
      { employee_id: bea, weight: 2_000n },
    ]);
    expect(suggestTipSplit(8_000n, weights)).toEqual([
      { employee_id: ada, amount: 6_000n },
      { employee_id: bea, amount: 2_000n },
    ]);
  });

  it('gives the leftover mill to the lowest employee id when shares are equal', () => {
    expect(
      suggestTipSplit(100n, [
        { employee_id: bea, weight: 1n },
        { employee_id: ada, weight: 1n },
        { employee_id: '01920000-0000-7000-8000-000000000008', weight: 1n },
      ]).map((row) => row.amount),
    ).toEqual([34n, 33n, 33n]);
  });

  it('rejects a non-positive tip', () => {
    expect(() => suggestTipSplit(0n, [{ employee_id: ada, weight: 1n }])).toThrow(RangeError);
  });
});
