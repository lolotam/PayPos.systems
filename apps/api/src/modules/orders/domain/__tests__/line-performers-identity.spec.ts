import { expect, it } from 'vitest';
import {
  assertChangerIsNotPerformer,
  requestedPerformerIdentities,
  type LinePerformersIdentity,
} from '../line-performers-identity.ts';
import type { LineEditPerformer } from '../line-edit-identity.ts';
import { SessionError } from '../session-error.ts';

function performer(over: Partial<LineEditPerformer> = {}): LineEditPerformer {
  return { linked_user_id: null, linked_user_snapshotted: true, current_user_id: null, ...over };
}

function identity(over: Partial<LinePerformersIdentity> = {}): LinePerformersIdentity {
  return { current: [], retained: [], ...over };
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

it('PC-08 refuses the changer linked to a current performer by her snapshot', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'u1',
      identity({ current: [performer({ linked_user_id: 'u1', current_user_id: 'u2' })] }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('PC-08 refuses the changer linked to a current performer by her current link', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'u2',
      identity({ current: [performer({ linked_user_id: 'u1', current_user_id: 'u2' })] }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('PC-11 refuses a match that is not the first performer of the line', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'u3',
      identity({
        current: [
          performer({ linked_user_id: 'u1', current_user_id: 'u1' }),
          performer({ linked_user_id: 'u2', current_user_id: 'u2' }),
          performer({ linked_user_id: 'u3', current_user_id: 'u4' }),
        ],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('PC-10 refuses a removed performer whose snapshot still blocks the line', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'removed-user',
      identity({
        current: [performer({ linked_user_id: 'current-user' })],
        retained: [performer({ linked_user_id: 'removed-user', current_user_id: null })],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('PC-10b refuses a removed performer linked to the changer after the removal', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'later-user',
      identity({
        current: [performer({ linked_user_id: 'current-user' })],
        retained: [performer({ linked_user_id: null, current_user_id: 'later-user' })],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('PC-12 fails closed on a current performer without an identity snapshot, even for an unrelated changer', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'manager',
      identity({ current: [performer({ linked_user_id: 'u1', linked_user_snapshotted: false })] }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('PC-12 fails closed on a retained identity without a snapshot, even for an unrelated changer', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer(
      'manager',
      identity({
        current: [performer({ linked_user_id: 'u1' })],
        retained: [performer({ linked_user_snapshotted: false })],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('fails closed on a line without current performers, before it compares anything', () => {
  const error = thrown(() =>
    assertChangerIsNotPerformer('manager', identity({ current: [] }), [
      performer({ current_user_id: 'manager' }),
    ]),
  );
  expect(error.code).toBe('SESSION_LINE_IDENTITY_UNKNOWN');
});

it('matches a user id whatever its letter case', () => {
  expect(
    thrown(() =>
      assertChangerIsNotPerformer(
        'u1',
        identity({ current: [performer({ linked_user_id: 'U1' })] }),
      ),
    ).code,
  ).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
  expect(
    thrown(() =>
      assertChangerIsNotPerformer(
        'u2',
        identity({ current: [performer({ current_user_id: 'U2' })] }),
      ),
    ).code,
  ).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('does not treat a null snapshot or a null current link as the changer', () => {
  expect(() =>
    assertChangerIsNotPerformer('manager', identity({ current: [performer()] })),
  ).not.toThrow();
});

it('allows a changer who matches neither snapshot nor current link', () => {
  expect(() =>
    assertChangerIsNotPerformer(
      'manager',
      identity({
        current: [performer({ linked_user_id: 'u1', current_user_id: 'u2' })],
        retained: [performer({ linked_user_id: null, current_user_id: 'u4' })],
      }),
    ),
  ).not.toThrow();
});

it('PC-13 builds the requested identity from the current link of the added employee and never from a snapshot', () => {
  const identities = requestedPerformerIdentities(['e1', 'e2'], [
    { id: 'e1', user_id: 'u1' },
    { id: 'e2', user_id: null },
  ]);
  expect(identities).toEqual([
    { linked_user_id: null, linked_user_snapshotted: true, current_user_id: 'u1' },
    { linked_user_id: null, linked_user_snapshotted: true, current_user_id: null },
  ]);
});

it('PC-13 gives an unknown employee a null current link instead of a guess', () => {
  expect(requestedPerformerIdentities(['ghost'], [])).toEqual([
    { linked_user_id: null, linked_user_snapshotted: true, current_user_id: null },
  ]);
});
