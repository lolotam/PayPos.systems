import { expect, it } from 'vitest';
import { resolveSessionChanger } from '../line-performers-changer.ts';
import type { SessionEditAccess } from '../line-edit-editor.ts';
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

it('returns the only eligible membership when none is selected', () => {
  expect(resolveSessionChanger(access(), undefined)).toBe('m1');
});

it('asks for a membership when several are eligible and none is selected', () => {
  const ids = ['m1', 'm2'];
  const error = thrown(() =>
    resolveSessionChanger(access({ eligible_membership_ids: ids }), undefined),
  );
  expect(error.code).toBe('SESSION_CHANGER_MEMBERSHIP_REQUIRED');
  expect(error.details).toEqual({ changer_membership_ids: ['m1', 'm2'] });
  expect(error.details).not.toHaveProperty('editor_membership_ids');
  expect(
    (error.details as { changer_membership_ids: string[] }).changer_membership_ids,
  ).not.toBe(ids);
});

it('refuses a supplied membership that is not eligible', () => {
  expect(
    thrown(() =>
      resolveSessionChanger(access({ eligible_membership_ids: ['m1', 'm2'] }), 'other'),
    ).code,
  ).toBe('FORBIDDEN');
});

it('returns a selection that is one of several eligible memberships', () => {
  expect(resolveSessionChanger(access({ eligible_membership_ids: ['m1', 'm2'] }), 'm2')).toBe('m2');
});

it('refuses a denied changer before the feature flag', () => {
  expect(
    thrown(() => resolveSessionChanger(access({ denied: true, feature: false }), 'm1')).code,
  ).toBe('FORBIDDEN');
});

it('refuses a disabled feature before accepting a selection', () => {
  expect(thrown(() => resolveSessionChanger(access({ feature: false }), 'm1')).code).toBe(
    'FEATURE_DISABLED',
  );
});
