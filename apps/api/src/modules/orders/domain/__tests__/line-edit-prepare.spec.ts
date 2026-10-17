import { expect, it } from 'vitest';
import { MONEY_MAX } from '@pospay/domain';
import { assertLineEditable, prepareLineEdit, type LineEditRequest } from '../line-edit-prepare.ts';
import { SessionError } from '../session-error.ts';
import type { SessionLimit } from '../session-types.ts';

const person = (bps: number): SessionLimit => ({ source: 'PERSON', bps });

function request(over: Partial<LineEditRequest> = {}): LineEditRequest {
  return {
    list_price: 25000n,
    current: { price: 25000n, discount: 2500n },
    requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 5000n } },
    limit: person(2000),
    other_active_nets: [],
    ...over,
  };
}

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

it('LE-01 saves net 20.000 at an effective 2000 bps within a 2000 limit', () => {
  const limit = person(2000);
  expect(prepareLineEdit(request({ limit }))).toEqual({
    price: 25000n,
    discount: 5000n,
    net: 20000n,
    effective_discount_bps: 2000,
    limit,
  });
});

it('LE-03 allows a price above list and stores an effective discount of 0', () => {
  const result = prepareLineEdit(
    request({
      requested: { price: 27000n, discount: { kind: 'AMOUNT', amount: 0n } },
    }),
  );
  expect(result).toMatchObject({
    price: 27000n,
    discount: 0n,
    net: 27000n,
    effective_discount_bps: 0,
  });
});

it('LE-04 saves an owner edit of 15.000 with no numeric limit', () => {
  const limit: SessionLimit = { source: 'OWNER', bps: null };
  expect(
    prepareLineEdit(
      request({
        requested: { price: 15000n, discount: { kind: 'AMOUNT', amount: 0n } },
        limit,
      }),
    ),
  ).toMatchObject({
    price: 15000n,
    discount: 0n,
    net: 15000n,
    effective_discount_bps: 4000,
    limit,
  });
});

it('LE-05 refuses 5.500 off a 25.000 list when the ceiling is 2000', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 5500n } },
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(error.details).toEqual({
    price: '25.000',
    discount: '5.500',
    net: '19.500',
    effective_discount_bps: 2200,
    limit_bps_applied: 2000,
    limit_source: 'PERSON',
    minimum_net: '20.000',
    max_discount_amount: '5.000',
  });
});

it('LE-06 refuses a half-up percent that lands one basis point over the limit', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        list_price: 7125n,
        current: { price: 7125n, discount: 0n },
        requested: { price: 7125n, discount: { kind: 'PERCENT', bps: 1000 } },
        limit: person(1000),
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(error.details).toEqual({
    price: '7.125',
    discount: '0.713',
    net: '6.412',
    effective_discount_bps: 1001,
    limit_bps_applied: 1000,
    limit_source: 'PERSON',
    minimum_net: '6.413',
    max_discount_amount: '0.712',
  });
});

it('LE-07 saves only a zero effective discount when the limit is not configured', () => {
  const limit: SessionLimit = { source: 'NOT_CONFIGURED', bps: 0 };
  expect(
    prepareLineEdit(
      request({
        current: { price: 25000n, discount: 1000n },
        requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 0n } },
        limit,
      }),
    ).effective_discount_bps,
  ).toBe(0);
  const error = thrown(() =>
    prepareLineEdit(
      request({
        requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 1n } },
        limit,
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(error.details).toMatchObject({
    limit_bps_applied: 0,
    limit_source: 'NOT_CONFIGURED',
    effective_discount_bps: 1,
  });
});

it('LE-08 refuses a lower discount that is still above the editor limit', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        current: { price: 25000n, discount: 10000n },
        requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 5500n } },
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
  expect(error.details).toMatchObject({ discount: '5.500', effective_discount_bps: 2200 });
});

it('converts PERCENT on the requested price and measures it against the stored list', () => {
  const result = prepareLineEdit(
    request({
      list_price: 25000n,
      current: { price: 25000n, discount: 0n },
      requested: { price: 10000n, discount: { kind: 'PERCENT', bps: 1000 } },
      limit: { source: 'OWNER', bps: null },
    }),
  );
  expect(result).toMatchObject({
    price: 10000n,
    discount: 1000n,
    net: 9000n,
    effective_discount_bps: 6400,
  });
});

it('refuses no change after a percent converts to the stored discount, before the limit', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        list_price: 7125n,
        current: { price: 7125n, discount: 713n },
        requested: { price: 7125n, discount: { kind: 'PERCENT', bps: 1000 } },
        limit: { source: 'NOT_CONFIGURED', bps: 0 },
      }),
    ),
  );
  expect(error.code).toBe('SESSION_EDIT_NO_CHANGE');
  expect(error.details).toBeUndefined();
});

it('refuses an invalid discount before no-change, the limit or the total', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        current: { price: 1000n, discount: 1001n },
        requested: { price: 1000n, discount: { kind: 'AMOUNT', amount: 1001n } },
        other_active_nets: [MONEY_MAX],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_INVALID');
});

it('refuses the limit before a visit total that would also overflow', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        requested: { price: 25000n, discount: { kind: 'AMOUNT', amount: 5500n } },
        other_active_nets: [MONEY_MAX],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_DISCOUNT_ABOVE_LIMIT');
});

it('refuses a visit total above numeric(14,3)', () => {
  const error = thrown(() =>
    prepareLineEdit(
      request({
        list_price: 1n,
        current: { price: 0n, discount: 0n },
        requested: { price: 1n, discount: { kind: 'AMOUNT', amount: 0n } },
        limit: { source: 'OWNER', bps: null },
        other_active_nets: [MONEY_MAX],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_TOTAL_TOO_LARGE');
});

it('keeps the editor limit object unchanged on the prepared line', () => {
  const limit = person(2000);
  expect(prepareLineEdit(request({ limit })).limit).toBe(limit);
});

it('refuses a stale revision before a cancelled line and carries only the current revision', () => {
  const error = thrown(() => assertLineEditable({ status: 'CANCELLED', revision: 4 }, 3));
  expect(error.code).toBe('SESSION_LINE_REVISION_STALE');
  expect(error.details).toEqual({ current_revision: 4 });
});

it('refuses a cancelled line once the revision matches', () => {
  const error = thrown(() => assertLineEditable({ status: 'CANCELLED', revision: 4 }, 4));
  expect(error.code).toBe('SESSION_LINE_NOT_EDITABLE');
  expect(error.details).toBeUndefined();
});

it('accepts an active line at the expected revision', () => {
  expect(() => assertLineEditable({ status: 'ACTIVE', revision: 2 }, 2)).not.toThrow();
});
