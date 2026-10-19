import { expect, it } from 'vitest';
import { lineActorAccess, linePerformerIdentities, refuseStaleLine, selectedLineMembership } from '../line-mutation-shared.ts';
import { SessionError } from '../session-error.ts';

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

it('maps denied, feature and eligible memberships into the shared actor shape', () => {
  expect(lineActorAccess({ denied: true, feature: false, eligible: [] })).toEqual({
    denied: true,
    feature: false,
    eligible_membership_ids: [],
  });
  expect(lineActorAccess({ denied: false, feature: true, eligible: [{ membership_id: 'm1' }] })).toEqual({
    denied: false,
    feature: true,
    eligible_membership_ids: ['m1'],
  });
});

it('refuses a membership that is not among the eligible facts', () => {
  expect(thrown(() => selectedLineMembership({ eligible: [{ membership_id: 'm1' }] }, 'other')).code).toBe('FORBIDDEN');
});

it('returns the selected membership unchanged', () => {
  const actor = { membership_id: 'm1', role: 'branch_manager' };
  expect(selectedLineMembership({ eligible: [actor] }, 'm1')).toBe(actor);
});

it('keeps a removed performer snapshot when the employee row is gone', () => {
  expect(linePerformerIdentities(
    [{ employee_id: 'e1', linked_user_id: 'u1', linked_user_snapshotted: true }],
    [],
  )).toEqual([{ linked_user_id: 'u1', linked_user_snapshotted: true, current_user_id: null }]);
});

it('reads the current user of a performer that is still employed', () => {
  expect(linePerformerIdentities(
    [{ employee_id: 'e1', linked_user_id: null, linked_user_snapshotted: true }],
    [{ id: 'e1', user_id: 'u-now' }],
  )).toEqual([{ linked_user_id: null, linked_user_snapshotted: true, current_user_id: 'u-now' }]);
});

it('refuses a line that disappeared and reports the live revision when it remains', async () => {
  await expect(refuseStaleLine(async () => null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(refuseStaleLine(async () => ({ revision: 4 }))).rejects.toMatchObject({
    code: 'SESSION_LINE_REVISION_STALE',
    details: { current_revision: 4 },
  });
});
