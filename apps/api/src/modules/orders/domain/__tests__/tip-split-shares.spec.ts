import { describe, expect, it } from 'vitest';
import { performerNetWeights, type TipWeightLine } from '../tip-split.ts';

const line = (
  net: bigint,
  performers: readonly { employee_id: string; share_bps: number }[],
  status: TipWeightLine['status'] = 'ACTIVE',
): TipWeightLine => ({ status, net, performers });

const solo = (employee_id: string, net: bigint): TipWeightLine =>
  line(net, [{ employee_id, share_bps: 10000 }]);

// الأرقام محسوبة يدوياً: أرضية (صافي × حصة / 10000) ثم فلس الباقي بالهوية تصاعدياً.
const shareCases: readonly [
  string,
  bigint,
  readonly { employee_id: string; share_bps: number }[],
  readonly { employee_id: string; weight: bigint }[],
][] = [
  [
    '1 performer, net 0',
    0n,
    [{ employee_id: 'a', share_bps: 10000 }],
    [{ employee_id: 'a', weight: 0n }],
  ],
  [
    '1 performer, net 1',
    1n,
    [{ employee_id: 'a', share_bps: 10000 }],
    [{ employee_id: 'a', weight: 1n }],
  ],
  [
    '1 performer, net 7',
    7n,
    [{ employee_id: 'a', share_bps: 10000 }],
    [{ employee_id: 'a', weight: 7n }],
  ],
  [
    '2 performers, net 0',
    0n,
    [
      { employee_id: 'b', share_bps: 5000 },
      { employee_id: 'a', share_bps: 5000 },
    ],
    [
      { employee_id: 'a', weight: 0n },
      { employee_id: 'b', weight: 0n },
    ],
  ],
  [
    '2 performers, net 1',
    1n,
    [
      { employee_id: 'b', share_bps: 5000 },
      { employee_id: 'a', share_bps: 5000 },
    ],
    [
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 0n },
    ],
  ],
  [
    '2 performers, net 7',
    7n,
    [
      { employee_id: 'a', share_bps: 5000 },
      { employee_id: 'b', share_bps: 5000 },
    ],
    [
      { employee_id: 'a', weight: 4n },
      { employee_id: 'b', weight: 3n },
    ],
  ],
  [
    '3 performers 3333/3333/3334, net 0',
    0n,
    [
      { employee_id: 'c', share_bps: 3334 },
      { employee_id: 'a', share_bps: 3333 },
      { employee_id: 'b', share_bps: 3333 },
    ],
    [
      { employee_id: 'a', weight: 0n },
      { employee_id: 'b', weight: 0n },
      { employee_id: 'c', weight: 0n },
    ],
  ],
  [
    '3 performers 3333/3333/3334, net 1',
    1n,
    [
      { employee_id: 'c', share_bps: 3334 },
      { employee_id: 'b', share_bps: 3333 },
      { employee_id: 'a', share_bps: 3333 },
    ],
    [
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 0n },
      { employee_id: 'c', weight: 0n },
    ],
  ],
  [
    '3 performers 3333/3333/3334, net 7',
    7n,
    [
      { employee_id: 'b', share_bps: 3333 },
      { employee_id: 'c', share_bps: 3334 },
      { employee_id: 'a', share_bps: 3333 },
    ],
    [
      { employee_id: 'a', weight: 3n },
      { employee_id: 'b', weight: 2n },
      { employee_id: 'c', weight: 2n },
    ],
  ],
  [
    '4 performers, uneven shares, net 0',
    0n,
    [
      { employee_id: 'd', share_bps: 4000 },
      { employee_id: 'a', share_bps: 1000 },
      { employee_id: 'c', share_bps: 3000 },
      { employee_id: 'b', share_bps: 2000 },
    ],
    [
      { employee_id: 'a', weight: 0n },
      { employee_id: 'b', weight: 0n },
      { employee_id: 'c', weight: 0n },
      { employee_id: 'd', weight: 0n },
    ],
  ],
  [
    '4 performers, uneven shares, net 1',
    1n,
    [
      { employee_id: 'd', share_bps: 4000 },
      { employee_id: 'c', share_bps: 3000 },
      { employee_id: 'b', share_bps: 2000 },
      { employee_id: 'a', share_bps: 1000 },
    ],
    [
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 0n },
      { employee_id: 'c', weight: 0n },
      { employee_id: 'd', weight: 0n },
    ],
  ],
  [
    '4 performers, uneven shares, net 7',
    7n,
    [
      { employee_id: 'a', share_bps: 1000 },
      { employee_id: 'b', share_bps: 2000 },
      { employee_id: 'c', share_bps: 3000 },
      { employee_id: 'd', share_bps: 4000 },
    ],
    [
      { employee_id: 'a', weight: 1n },
      { employee_id: 'b', weight: 2n },
      { employee_id: 'c', weight: 2n },
      { employee_id: 'd', weight: 2n },
    ],
  ],
  [
    'uneven 2500/7500, net 7',
    7n,
    [
      { employee_id: 'b', share_bps: 7500 },
      { employee_id: 'a', share_bps: 2500 },
    ],
    [
      { employee_id: 'a', weight: 2n },
      { employee_id: 'b', weight: 5n },
    ],
  ],
];

describe('performerNetWeights commission share table', () => {
  it.each(shareCases)('%s', (_label, net, performers, expected) => {
    expect(performerNetWeights([line(net, performers)])).toEqual(expected);
  });
});

describe('performerNetWeights share contract', () => {
  it.each([
    [
      'duplicate ids',
      1n,
      [
        { employee_id: 'a', share_bps: 5000 },
        { employee_id: 'A', share_bps: 5000 },
      ],
    ],
    [
      'a zero share',
      1n,
      [
        { employee_id: 'a', share_bps: 0 },
        { employee_id: 'b', share_bps: 10000 },
      ],
    ],
    ['a fractional share', 1n, [{ employee_id: 'a', share_bps: 10000.5 }]],
    ['a negative share', 1n, [{ employee_id: 'a', share_bps: -10000 }]],
    [
      'shares that do not sum to 10000',
      1n,
      [
        { employee_id: 'a', share_bps: 4000 },
        { employee_id: 'b', share_bps: 4000 },
      ],
    ],
    ['a negative net', -1n, [{ employee_id: 'a', share_bps: 10000 }]],
  ] as const)('refuses %s', (_label, net, performers) => {
    expect(() => performerNetWeights([line(net, performers)])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('does not apply the share contract to a cancelled line', () => {
    expect(
      performerNetWeights([
        line(-1n, [{ employee_id: 'a', share_bps: 1 }], 'CANCELLED'),
        solo('heba', 20_000n),
      ]),
    ).toEqual([{ employee_id: 'heba', weight: 20_000n }]);
  });
});
