import { expect, it } from 'vitest';

import { orderCommissionLines } from '../line-order.ts';
import { allocateLineShares } from '../line-shares.ts';

it('CE1-ORDER sorts by occurred time, then recorded time, then id without mutation', () => {
  const lines = Object.freeze(
    [
      { lineId: 'd', occurredAt: 20n, recordedAt: 1n },
      { lineId: 'c', occurredAt: 10n, recordedAt: 3n },
      { lineId: 'b', occurredAt: 10n, recordedAt: 2n },
      { lineId: 'a', occurredAt: 10n, recordedAt: 2n },
    ].map((line) => Object.freeze(line)),
  );
  expect(orderCommissionLines(lines).map((line) => line.lineId)).toEqual(['a', 'b', 'c', 'd']);
  expect(lines.map((line) => line.lineId)).toEqual(['d', 'c', 'b', 'a']);
  expect(orderCommissionLines([...lines].reverse())).toEqual(orderCommissionLines(lines));
});

it('CE1-ORDER preserves microsecond precision and places late entries by occurrence', () => {
  const old = { lineId: 'old', occurredAt: 1_000_000_000_000_002n, recordedAt: 2n };
  const late = { lineId: 'late', occurredAt: 1_000_000_000_000_001n, recordedAt: 999n };
  expect(orderCommissionLines([old, late])).toEqual([late, old]);
  expect(orderCommissionLines([])).toEqual([]);
  expect(orderCommissionLines([old])).toEqual([old]);
  expect(orderCommissionLines([old, old])).toEqual([old, old]);
});

it.each([
  [0n, [5000n, 5000n], [0n, 0n]],
  [1n, [5000n, 5000n], [1n, 0n]],
  [5n, [5000n, 5000n], [3n, 2n]],
  [7n, [2500n, 7500n], [2n, 5n]],
  [2n, [3333n, 3333n, 3334n], [1n, 1n, 0n]],
  [1001n, [3333n, 3333n, 3334n], [334n, 334n, 333n]],
  [1n, [0n, 5000n, 5000n], [1n, 0n, 0n]],
  [99_999_999_999_999n, [5000n, 5000n], [50_000_000_000_000n, 49_999_999_999_999n]],
] as const)('CE1-SHARES allocates %s mills exactly by employee id', (net, bps, expected) => {
  const performers = bps.map((shareBps, index) => ({ employeeId: `employee-${index}`, shareBps }));
  const original = performers.map((performer) => Object.freeze(performer)).reverse();
  const shares = allocateLineShares(net, Object.freeze(original));
  expect([...shares.values()]).toEqual(expected);
  expect([...shares.values()].reduce((sum, value) => sum + value, 0n)).toBe(net);
  expect(allocateLineShares(net, [...original].reverse())).toEqual(shares);
});

it('CE1-SHARES uses the supplied package slot value and preserves a solo share', () => {
  expect(allocateLineShares(1234n, [{ employeeId: 'a', shareBps: 10000n }])).toEqual(
    new Map([['a', 1234n]]),
  );
});
