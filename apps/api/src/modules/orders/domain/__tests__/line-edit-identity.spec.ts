import { expect, it } from 'vitest';
import { assertEditorIsNotPerformer, type LineEditPerformer } from '../line-edit-identity.ts';
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

it('refuses an empty performer list as unknown identity', () => {
  expect(thrown(() => assertEditorIsNotPerformer('editor', [])).code).toBe(
    'SESSION_EDIT_IDENTITY_UNKNOWN',
  );
});

it('refuses an unsnapshotted performer before comparing user ids', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('editor', [
      performer({
        linked_user_id: 'editor',
        linked_user_snapshotted: false,
        current_user_id: 'editor',
      }),
    ]),
  );
  expect(error.code).toBe('SESSION_EDIT_IDENTITY_UNKNOWN');
});

it('refuses the line when any performer lacks a snapshot', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('manager', [
      performer({ linked_user_id: 'u1', current_user_id: 'u2' }),
      performer({ linked_user_snapshotted: false }),
    ]),
  );
  expect(error.code).toBe('SESSION_EDIT_IDENTITY_UNKNOWN');
});

it('refuses a snapshot match even when the current link is someone else', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('u1', [performer({ linked_user_id: 'u1', current_user_id: 'u2' })]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('refuses a current-link match even when the snapshot is someone else', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('u2', [performer({ linked_user_id: 'u1', current_user_id: 'u2' })]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('refuses when the snapshot and the current link are both the editor', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('u1', [performer({ linked_user_id: 'u1', current_user_id: 'u1' })]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('does not treat null performer ids as the editor', () => {
  expect(() => assertEditorIsNotPerformer('editor', [performer()])).not.toThrow();
});

it('refuses when any of several performers matches by either source', () => {
  const error = thrown(() =>
    assertEditorIsNotPerformer('u4', [
      performer({ linked_user_id: 'u1', current_user_id: null }),
      performer({ linked_user_id: null, current_user_id: 'u4' }),
    ]),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SELF_FORBIDDEN');
});

it('allows an editor who matches neither snapshot nor current link', () => {
  expect(() =>
    assertEditorIsNotPerformer('u3', [
      performer({ linked_user_id: 'u1', current_user_id: 'u2' }),
      performer({ linked_user_id: null, current_user_id: 'u4' }),
    ]),
  ).not.toThrow();
});
