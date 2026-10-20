import { expect, it } from 'vitest';
import { evaluateLinePerformersChange, type LinePerformersFacts } from '../line-performers-evaluate.ts';
import type { LinePerformerRow } from '../line-performers-plan.ts';
import type { LineEditPerformer } from '../line-edit-identity.ts';
import type { LinePerformersIdentity } from '../line-performers-identity.ts';
import { SessionError } from '../session-error.ts';
import type { SessionEmployee } from '../session-types.ts';

const now = new Date('2026-10-17T08:00:00.000Z');

function row(over: Partial<LinePerformerRow> = {}): LinePerformerRow {
  return {
    employee_id: 'sara',
    performer_ordinal: 1,
    share_bps: 10000,
    name_en: 'Sara',
    name_ar: null,
    linked_user_id: null,
    linked_user_snapshotted: true,
    not_clocked_in_warning: false,
    approved_leave_warning: false,
    ...over,
  };
}

function employee(over: Partial<SessionEmployee> = {}): SessionEmployee {
  return {
    id: 'rana',
    name_en: 'Rana',
    name_ar: null,
    user_id: null,
    eligible: true,
    clocked_in: true,
    approved_leave: false,
    ...over,
  };
}

function performer(over: Partial<LineEditPerformer> = {}): LineEditPerformer {
  return { linked_user_id: null, linked_user_snapshotted: true, current_user_id: null, ...over };
}

function identity(over: Partial<LinePerformersIdentity> = {}): LinePerformersIdentity {
  return { current: [], retained: [], requested: [], ...over };
}

function facts(over: Partial<LinePerformersFacts> = {}): LinePerformersFacts {
  return {
    actor_user_id: 'manager',
    identities: identity({ current: [performer()] }),
    preparation: {
      line: { status: 'ACTIVE', revision: 1, not_changeable: false },
      expected_revision: 1,
      business_date: '2026-10-12',
      now,
      business_timezone: 'Asia/Kuwait',
      reason: 'رنا شاركت في الشطف',
      current_performers: [row()],
      requested_performers: [
        { employee_id: 'sara', share_bps: 7000 },
        { employee_id: 'rana', share_bps: 3000 },
      ],
      added_employees: [employee()],
    },
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

it('accepts a changer who performs nothing on the line and returns the plan', () => {
  const result = evaluateLinePerformersChange(facts());
  expect(result.revision).toBe(2);
  expect(result.added_ids).toEqual(['rana']);
});

it('refuses the identity before the stale revision', () => {
  const error = thrown(() =>
    evaluateLinePerformersChange(
      facts({
        actor_user_id: 'sara-user',
        identities: identity({ current: [performer({ linked_user_id: 'sara-user' })] }),
        preparation: { ...facts().preparation, expected_revision: 9 },
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('fails closed on a line without an identity snapshot before anything else', () => {
  const error = thrown(() =>
    evaluateLinePerformersChange(
      facts({
        identities: identity({ current: [performer({ linked_user_snapshotted: false })] }),
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});
