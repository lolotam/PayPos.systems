import { MONEY_MAX } from '@pospay/domain';
import { expect, it, describe } from 'vitest';
import { SessionError } from '../session-error.ts';
import { performerNetWeights, suggestTipSplit, type TipWeightLine } from '../tip-split.ts';

const line = (
  net: bigint,
  performers: readonly { employee_id: string; share_bps: number }[],
  status: TipWeightLine['status'] = 'ACTIVE',
): TipWeightLine => ({ status, net, performers });

const solo = (employee_id: string, net: bigint): TipWeightLine =>
  line(net, [{ employee_id, share_bps: 10000 }]);

describe('suggestTipSplit worked examples', () => {
  it('suggests 6.000 and 2.000 for 8.000 over nets 60.000 and 20.000', () => {
    const weights = performerNetWeights([solo('sara', 60_000n), solo('heba', 20_000n)]);
    expect(weights).toEqual([
      { employee_id: 'heba', weight: 20_000n },
      { employee_id: 'sara', weight: 60_000n },
    ]);
    expect(suggestTipSplit(8_000n, weights)).toEqual([
      { employee_id: 'heba', amount: 2_000n },
      { employee_id: 'sara', amount: 6_000n },
    ]);
  });

  it('gives the extra mill of 0.100 to the smallest of three equal ids', () => {
    expect(
      suggestTipSplit(100n, [
        { employee_id: 'c', weight: 1_000n },
        { employee_id: 'a', weight: 1_000n },
        { employee_id: 'b', weight: 1_000n },
      ]),
    ).toEqual([
      { employee_id: 'a', amount: 34n },
      { employee_id: 'b', amount: 33n },
      { employee_id: 'c', amount: 33n },
    ]);
  });

  it('leaves out a zero-weight employee when 0.010 goes entirely to the other', () => {
    expect(
      suggestTipSplit(10n, [
        { employee_id: 'a', weight: 1n },
        { employee_id: 'b', weight: 0n },
      ]),
    ).toEqual([{ employee_id: 'a', amount: 10n }]);
  });

  it('gives 0.002 as one mill each to the two smallest of four equal performers', () => {
    const weights = ['d', 'b', 'c', 'a'].map((employee_id) => ({ employee_id, weight: 1n }));
    expect(suggestTipSplit(2n, weights)).toEqual([
      { employee_id: 'a', amount: 1n },
      { employee_id: 'b', amount: 1n },
    ]);
  });

  it('splits a 0.001 line shared 50/50 to the lower employee id and leaves the other at zero', () => {
    expect(
      performerNetWeights([
        line(1n, [
          { employee_id: 'b', share_bps: 5000 },
          { employee_id: 'a', share_bps: 5000 },
        ]),
      ]),
    ).toEqual([
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 0n },
    ]);
  });
});

describe('suggestTipSplit edges', () => {
  it('splits a zero-net visit equally, including the remainder mill', () => {
    expect(
      suggestTipSplit(10n, [
        { employee_id: 'c', weight: 0n },
        { employee_id: 'a', weight: 0n },
        { employee_id: 'b', weight: 0n },
      ]),
    ).toEqual([
      { employee_id: 'a', amount: 4n },
      { employee_id: 'b', amount: 3n },
      { employee_id: 'c', amount: 3n },
    ]);
  });

  it('builds zero weights from active zero-net lines and then splits equally', () => {
    const weights = performerNetWeights([
      line(0n, [
        { employee_id: 'b', share_bps: 5000 },
        { employee_id: 'a', share_bps: 5000 },
      ]),
    ]);
    expect(weights).toEqual([
      { employee_id: 'a', weight: 0n },
      { employee_id: 'b', weight: 0n },
    ]);
    expect(suggestTipSplit(5n, weights)).toEqual([
      { employee_id: 'a', amount: 3n },
      { employee_id: 'b', amount: 2n },
    ]);
  });

  it('gives a single performer the whole tip', () => {
    expect(suggestTipSplit(8_000n, [{ employee_id: 'sara', weight: 60_000n }])).toEqual([
      { employee_id: 'sara', amount: 8_000n },
    ]);
  });
});

describe('suggestTipSplit remainders', () => {
  it('gives a tied remainder to the smaller id', () => {
    expect(
      suggestTipSplit(5n, [
        { employee_id: 'c', weight: 1n },
        { employee_id: 'a', weight: 1n },
        { employee_id: 'b', weight: 1n },
      ]),
    ).toEqual([
      { employee_id: 'a', amount: 2n },
      { employee_id: 'b', amount: 2n },
      { employee_id: 'c', amount: 1n },
    ]);
  });

  it('gives an untied remainder to the larger fraction even when that id is larger', () => {
    expect(
      suggestTipSplit(10n, [
        { employee_id: 'a', weight: 1n },
        { employee_id: 'b', weight: 2n },
      ]),
    ).toEqual([
      { employee_id: 'a', amount: 3n },
      { employee_id: 'b', amount: 7n },
    ]);
  });

  it('refuses a zero or negative tip and returns no suggestion when nobody can receive one', () => {
    expect(() => suggestTipSplit(0n, [])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() => suggestTipSplit(-1n, [{ employee_id: 'a', weight: 1n }])).toThrow(SessionError);
    expect(suggestTipSplit(100n, [])).toEqual([]);
    expect(performerNetWeights([])).toEqual([]);
  });

  it('refuses a negative weight', () => {
    expect(() =>
      suggestTipSplit(10n, [
        { employee_id: 'a', weight: -1n },
        { employee_id: 'b', weight: 5n },
      ]),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });
});

describe('performerNetWeights', () => {
  it('compares employee ids as lowercase strings', () => {
    expect(
      performerNetWeights([
        line(1n, [
          { employee_id: 'B', share_bps: 5000 },
          { employee_id: 'a', share_bps: 5000 },
        ]),
      ]),
    ).toEqual([
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 0n },
    ]);
    expect(
      suggestTipSplit(1n, [
        { employee_id: 'B', weight: 1n },
        { employee_id: 'a', weight: 1n },
      ]),
    ).toEqual([{ employee_id: 'a', amount: 1n }]);
  });

  it('ignores cancelled lines', () => {
    expect(
      performerNetWeights([
        line(60_000n, [{ employee_id: 'sara', share_bps: 10000 }], 'CANCELLED'),
        solo('heba', 20_000n),
      ]),
    ).toEqual([{ employee_id: 'heba', weight: 20_000n }]);
  });

  it('sums one performer across several active lines', () => {
    expect(
      performerNetWeights([
        solo('sara', 10_000n),
        line(5_000n, [
          { employee_id: 'sara', share_bps: 5000 },
          { employee_id: 'heba', share_bps: 5000 },
        ]),
        line(1n, [
          { employee_id: 'Sara', share_bps: 5000 },
          { employee_id: 'heba', share_bps: 5000 },
        ]),
      ]),
    ).toEqual([
      { employee_id: 'heba', weight: 2_501n },
      { employee_id: 'sara', weight: 12_500n },
    ]);
  });
});

describe('suggestTipSplit near the money limit', () => {
  it('splits a tip near MONEY_MAX across large weights without losing a mill', () => {
    const tip = MONEY_MAX;
    const heavier = { employee_id: 'b', weight: MONEY_MAX };
    const lighter = { employee_id: 'a', weight: MONEY_MAX - 1n };
    const result = suggestTipSplit(tip, [heavier, lighter]);
    const total = heavier.weight + lighter.weight;
    expect(result.reduce((sum, row) => sum + row.amount, 0n)).toBe(tip);
    for (const row of result) {
      expect(row.amount > 0n).toBe(true);
      const weight = row.employee_id === 'a' ? lighter.weight : heavier.weight;
      const delta = row.amount * total - tip * weight;
      expect((delta < 0n ? -delta : delta) < total).toBe(true);
    }
  });
});

function withinOneMill(amount: bigint, tip: bigint, weight: bigint, divisor: bigint): boolean {
  const delta = amount * divisor - tip * weight;
  const distance = delta < 0n ? -delta : delta;
  return distance < divisor;
}

function assertExactSplit(
  tip: bigint,
  weights: readonly { employee_id: string; weight: bigint }[],
): void {
  const result = suggestTipSplit(tip, weights);
  expect(result.reduce((sum, row) => sum + row.amount, 0n)).toBe(tip);
  for (const row of result) expect(row.amount > 0n).toBe(true);
  const total = weights.reduce((sum, row) => sum + row.weight, 0n);
  const divisor = total === 0n ? BigInt(weights.length) : total;
  const byId = new Map(result.map((row) => [row.employee_id, row.amount]));
  for (const row of weights) {
    const amount = byId.get(row.employee_id) ?? 0n;
    const weight = total === 0n ? 1n : row.weight;
    expect(withinOneMill(amount, tip, weight, divisor)).toBe(true);
    if (total > 0n && row.weight === 0n) expect(amount).toBe(0n);
  }
}

describe('suggestTipSplit seeded properties', () => {
  it('keeps seeded splits exact, including zero weights and a tip smaller than the performer count', () => {
    const state = { value: 0x3602 };
    const next = () => {
      state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
      return BigInt(state.value);
    };
    for (let index = 0; index < 300; index += 1) {
      const count = (index % 8) + 1;
      const weights = Array.from({ length: count }, (_, employee) => ({
        employee_id: `e${employee}`,
        weight:
          index % 5 === 0 || (index % 5 === 1 && employee === 0) ? 0n : (next() % 50_000n) + 1n,
      }));
      const tip =
        index % 4 === 0 && count > 1 ? (next() % BigInt(count - 1)) + 1n : (next() % 20_000n) + 1n;
      assertExactSplit(tip, weights);
    }
  });
});
