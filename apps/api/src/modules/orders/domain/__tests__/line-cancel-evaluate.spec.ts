import { expect, it } from 'vitest';
import { evaluateLineCancel, type LineCancelFacts } from '../line-cancel-evaluate.ts';
import type { LineEditPerformer } from '../line-edit-identity.ts';
import { prepareLineCancel, type PrepareLineCancelInput } from '../line-cancel-prepare.ts';
import { SessionError } from '../session-error.ts';

function performer(over: Partial<LineEditPerformer> = {}): LineEditPerformer {
  return {
    linked_user_id: 'performer',
    linked_user_snapshotted: true,
    current_user_id: null,
    ...over,
  };
}

function preparation(over: Partial<PrepareLineCancelInput> = {}): PrepareLineCancelInput {
  return {
    line: {
      status: 'ACTIVE',
      revision: 2,
      price: 10000n,
      discount: 0n,
      net: 10000n,
      not_cancellable: false,
    },
    expected_revision: 1,
    business_date: '2026-08-31',
    now: new Date('2026-10-17T08:00:00.000Z'),
    business_timezone: 'Asia/Kuwait',
    reason: undefined,
    line_id: 'line-1',
    active_lines: [{ id: 'line-1' }],
    performers_by_line: new Map([['line-1', ['sara']]]),
    current_tip_employee_ids: ['sara'],
    ...over,
  };
}

function facts(over: Partial<LineCancelFacts> = {}): LineCancelFacts {
  return {
    actor_user_id: 'manager',
    performers: [performer()],
    preparation: preparation(),
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

it('returns the unknown-identity refusal before a stale revision', () => {
  const error = thrown(() =>
    evaluateLineCancel(
      facts({
        performers: [performer({ linked_user_id: 'manager', linked_user_snapshotted: false })],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('returns the self refusal before the tip guard, owner included', () => {
  const error = thrown(() =>
    evaluateLineCancel(
      facts({
        actor_user_id: 'owner-user',
        performers: [performer({ linked_user_id: 'owner-user' })],
        preparation: preparation({
          expected_revision: 2,
          business_date: '2026-10-12',
          reason: 'سبب',
        }),
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('returns the first later refusal once identity is clear', () => {
  expect(thrown(() => evaluateLineCancel(facts())).code).toBe('SESSION_LINE_REVISION_STALE');
});

it('refuses a retained identity passed in the same list', () => {
  const error = thrown(() =>
    evaluateLineCancel(
      facts({
        actor_user_id: 'removed-user',
        performers: [
          performer({ linked_user_id: 'current-user' }),
          performer({ linked_user_id: 'removed-user' }),
        ],
        preparation: preparation({
          expected_revision: 2,
          business_date: '2026-10-12',
          reason: 'سبب',
          current_tip_employee_ids: [],
        }),
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('accepts a clear canceller and keeps the prepared revision', () => {
  const ready = preparation({
    line: {
      status: 'ACTIVE',
      revision: 3,
      price: 10000n,
      discount: 0n,
      net: 10000n,
      not_cancellable: false,
    },
    expected_revision: 3,
    business_date: '2026-10-12',
    reason: 'سبب الإلغاء',
    current_tip_employee_ids: [],
  });
  expect(evaluateLineCancel(facts({ preparation: ready }))).toEqual(prepareLineCancel(ready));
});
