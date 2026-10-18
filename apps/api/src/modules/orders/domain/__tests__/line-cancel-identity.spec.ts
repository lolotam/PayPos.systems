import { expect, it } from 'vitest';
import { assertCancellerIsNotPerformer } from '../line-cancel-identity.ts';
import type { LineEditPerformer } from '../line-edit-identity.ts';
import { SessionError } from '../session-error.ts';

function performer(over: Partial<LineEditPerformer> = {}): LineEditPerformer {
  return { linked_user_id: null, linked_user_snapshotted: true, current_user_id: null, ...over };
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

it('refuses an unsnapshotted line before comparing user ids', () => {
  const error = thrown(() =>
    assertCancellerIsNotPerformer('owner', [
      performer({
        linked_user_id: 'owner',
        linked_user_snapshotted: false,
        current_user_id: 'owner',
      }),
    ]),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('refuses a snapshot match', () => {
  const error = thrown(() =>
    assertCancellerIsNotPerformer('u1', [
      performer({ linked_user_id: 'u1', current_user_id: 'u2' }),
    ]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('refuses a current-link match', () => {
  const error = thrown(() =>
    assertCancellerIsNotPerformer('u2', [
      performer({ linked_user_id: 'u1', current_user_id: 'u2' }),
    ]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('refuses a retained identity of a performer removed by 37b when the caller includes her', () => {
  const error = thrown(() =>
    assertCancellerIsNotPerformer('removed-user', [
      performer({ linked_user_id: 'current-user', current_user_id: 'current-link' }),
      performer({ linked_user_id: 'removed-user', current_user_id: null }),
    ]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('does not treat a null snapshot or current link as the canceller', () => {
  expect(() => assertCancellerIsNotPerformer('canceller', [performer()])).not.toThrow();
});

it('refuses the owner when her user id is a performer, because the rule has no role exemption', () => {
  const error = thrown(() =>
    assertCancellerIsNotPerformer('owner-user', [
      performer({ linked_user_id: 'owner-user', current_user_id: 'someone-else' }),
    ]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('allows a canceller who matches neither snapshot nor current link', () => {
  expect(() =>
    assertCancellerIsNotPerformer('manager', [
      performer({ linked_user_id: 'u1', current_user_id: 'u2' }),
      performer({ linked_user_id: null, current_user_id: 'u4' }),
    ]),
  ).not.toThrow();
});
