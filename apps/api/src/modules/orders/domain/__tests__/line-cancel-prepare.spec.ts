import { expect, it } from 'vitest';
import {
  prepareLineCancel,
  type CancelLineState,
  type PrepareLineCancelInput,
} from '../line-cancel-prepare.ts';
import { SessionError } from '../session-error.ts';

const now = new Date('2026-10-17T08:00:00.000Z');

function line(over: Partial<CancelLineState> = {}): CancelLineState {
  return {
    status: 'ACTIVE',
    revision: 1,
    price: 25000n,
    discount: 2500n,
    net: 22500n,
    not_cancellable: false,
    ...over,
  };
}

function input(over: Partial<PrepareLineCancelInput> = {}): PrepareLineCancelInput {
  return {
    line: line(),
    expected_revision: 1,
    business_date: '2026-10-12',
    now,
    business_timezone: 'Asia/Kuwait',
    reason: 'العميلة رفضت الخدمة',
    line_id: 'line-1',
    active_lines: [{ id: 'line-1' }],
    performers_by_line: new Map([['line-1', ['sara']]]),
    current_tip_employee_ids: [],
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

const stacked = {
  business_date: '2026-08-31',
  reason: '   ',
  current_tip_employee_ids: ['sara'],
};

it('refuses a stale revision before an already-cancelled line', () => {
  const error = thrown(() =>
    prepareLineCancel(
      input({
        ...stacked,
        line: line({ status: 'CANCELLED', revision: 4, not_cancellable: true }),
        expected_revision: 3,
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_REVISION_STALE');
  expect(error.details).toEqual({ current_revision: 4 });
});

it('LC-21 refuses a second cancel that carries the current revision of a cancelled line', () => {
  const error = thrown(() =>
    prepareLineCancel(
      input({
        ...stacked,
        line: line({ status: 'CANCELLED', revision: 4, not_cancellable: true }),
        expected_revision: 4,
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_ALREADY_CANCELLED');
  expect(error.details).toBeUndefined();
});

it('refuses the reserved not-cancellable marker before the window', () => {
  const error = thrown(() =>
    prepareLineCancel(input({ ...stacked, line: line({ not_cancellable: true }) })),
  );
  expect(error.code).toBe('SESSION_LINE_NOT_CANCELLABLE');
});

it('refuses a closed window before an invalid reason', () => {
  expect(thrown(() => prepareLineCancel(input(stacked))).code).toBe('SESSION_TIME_TOO_OLD');
});

it('refuses an invalid reason before the tip guard', () => {
  const error = thrown(() =>
    prepareLineCancel(input({ reason: '\t', current_tip_employee_ids: ['sara'] })),
  );
  expect(error.code).toBe('SESSION_CANCEL_REASON_INVALID');
});

it('refuses when the tip guard names a performer and returns ids only', () => {
  const error = thrown(() => prepareLineCancel(input({ current_tip_employee_ids: ['sara'] })));
  expect(error.code).toBe('SESSION_CANCEL_BLOCKED_BY_TIP');
  expect(error.details).toEqual({ employee_ids: ['sara'] });
});

it('accepts a cancel without changing money and increments the revision', () => {
  const current = line({ revision: 7 });
  const result = prepareLineCancel(
    input({ line: current, expected_revision: 7, reason: ' \tسبب الإلغاء\r\n ' }),
  );
  expect(result).toEqual({
    status: 'CANCELLED',
    revision: 8,
    previous: { revision: 7, price: 25000n, discount: 2500n, net: 22500n },
  });
  expect(current).toEqual(line({ revision: 7 }));
  expect(result).not.toHaveProperty('price');
});
