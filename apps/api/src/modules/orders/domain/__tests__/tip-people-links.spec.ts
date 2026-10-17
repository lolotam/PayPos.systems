import { expect, it } from 'vitest';
import { SessionError } from '../session-error.ts';
import { withCurrentLinks, type TipPerformerRow } from '../tip-people-links.ts';

const sara = '01990000-0000-7000-8000-00000000000b';
const hiba = '01990000-0000-7000-8000-00000000000c';
const user = '01990000-0000-7000-8000-0000000000d1';
const snapshot = { linked_user_id: user, linked_user_snapshotted: true };

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

function row(employee_id: string, has_active_line = true): TipPerformerRow {
  return { employee_id, has_active_line, identities: [snapshot] };
}

it('joins each performer row with the current link read after the lock', () => {
  expect(withCurrentLinks([row(sara)], [{ id: sara, user_id: user }], [sara])).toEqual([
    {
      employee_id: sara,
      has_active_line: true,
      identities: [snapshot],
      current_user_id: user,
    },
  ]);
});

it('matches employee ids without regard to case', () => {
  const upper = sara.toUpperCase();
  const [person] = withCurrentLinks([row(upper)], [{ id: sara, user_id: user }], [upper]);
  expect(person?.employee_id).toBe(upper);
  expect(person?.current_user_id).toBe(user);
});

it('refuses an involved employee the read did not return', () => {
  expect(thrown(() => withCurrentLinks([row(sara)], [], [sara])).code).toBe('TIP_IDENTITY_UNKNOWN');
  expect(
    thrown(() => withCurrentLinks([], [{ id: sara, user_id: user }], [sara, hiba])).code,
  ).toBe('TIP_IDENTITY_UNKNOWN');
  expect(thrown(() => withCurrentLinks([row(sara)], [], [])).code).toBe('TIP_IDENTITY_UNKNOWN');
});

it('keeps a null current link as null', () => {
  const [person] = withCurrentLinks([row(sara)], [{ id: sara, user_id: null }], [sara]);
  expect(person?.current_user_id).toBeNull();
});

it('keeps several rows for one employee as several people', () => {
  const rows = [row(sara, true), { employee_id: sara, has_active_line: false, identities: [] }];
  const people = withCurrentLinks(rows, [{ id: sara, user_id: user }], [sara]);
  expect(people).toEqual([
    {
      employee_id: sara,
      has_active_line: true,
      identities: [snapshot],
      current_user_id: user,
    },
    { employee_id: sara, has_active_line: false, identities: [], current_user_id: user },
  ]);
});
