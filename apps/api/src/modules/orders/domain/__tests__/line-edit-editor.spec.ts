import { expect, it } from 'vitest';
import { resolveSessionEditor, type SessionEditAccess } from '../line-edit-editor.ts';
import { SessionError } from '../session-error.ts';

function access(over: Partial<SessionEditAccess> = {}): SessionEditAccess {
  return { denied: false, feature: true, eligible_membership_ids: ['m1'], ...over };
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

it('refuses a denied editor before the feature flag', () => {
  expect(
    thrown(() => resolveSessionEditor(access({ denied: true, feature: false }), 'm1')).code,
  ).toBe('FORBIDDEN');
});

it('refuses when no membership is eligible', () => {
  expect(
    thrown(() => resolveSessionEditor(access({ eligible_membership_ids: [] }), 'm1')).code,
  ).toBe('FORBIDDEN');
});

it('refuses a disabled feature before accepting a selection', () => {
  expect(thrown(() => resolveSessionEditor(access({ feature: false }), 'm1')).code).toBe(
    'FEATURE_DISABLED',
  );
});

it('returns the only eligible membership when none is selected', () => {
  expect(resolveSessionEditor(access(), undefined)).toBe('m1');
});

it('returns a selection that is one of several eligible memberships', () => {
  expect(resolveSessionEditor(access({ eligible_membership_ids: ['m1', 'm2'] }), 'm2')).toBe('m2');
});

it('refuses a selection that is not eligible', () => {
  expect(
    thrown(() => resolveSessionEditor(access({ eligible_membership_ids: ['m1', 'm2'] }), 'other'))
      .code,
  ).toBe('FORBIDDEN');
});

it('asks for a membership when several are eligible and none is selected', () => {
  const ids = ['m1', 'm2'];
  const error = thrown(() =>
    resolveSessionEditor(access({ eligible_membership_ids: ids }), undefined),
  );
  expect(error.code).toBe('SESSION_EDITOR_MEMBERSHIP_REQUIRED');
  expect(error.details).toEqual({ editor_membership_ids: ['m1', 'm2'] });
  expect((error.details as { editor_membership_ids: string[] }).editor_membership_ids).not.toBe(
    ids,
  );
});
