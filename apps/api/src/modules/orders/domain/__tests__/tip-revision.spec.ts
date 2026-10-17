import { expect, it } from 'vitest';
import { SessionError } from '../session-error.ts';
import { assertTipChange, assertTipRevision, nextTipRevision } from '../tip-revision.ts';

function thrown(run: () => void): SessionError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return error as SessionError;
  }
  throw new Error('expected a SessionError');
}

it('accepts a matching revision, including the first entry at zero', () => {
  expect(() => assertTipRevision(0, 0)).not.toThrow();
  expect(() => assertTipRevision(3, 3)).not.toThrow();
});

it('refuses a stale revision with only the current revision in the details', () => {
  const error = thrown(() => assertTipRevision(3, 2));
  expect(error.code).toBe('TIP_REVISION_CONFLICT');
  expect(error.details).toEqual({ current_revision: 3 });
  expect(Object.keys(error.details as object)).toEqual(['current_revision']);
});

it('reports the stored revision when the caller is still on zero', () => {
  const error = thrown(() => assertTipRevision(0, 1));
  expect(error.code).toBe('TIP_REVISION_CONFLICT');
  expect(error.details).toEqual({ current_revision: 0 });
});

it('starts the chain at revision 1 and then steps by one', () => {
  expect(nextTipRevision(0)).toEqual({ revision: 1, previous_revision: null });
  expect(nextTipRevision(1)).toEqual({ revision: 2, previous_revision: 1 });
  expect(nextTipRevision(4)).toEqual({ revision: 5, previous_revision: 4 });
});

it('refuses a set that changes nothing', () => {
  expect(thrown(() => assertTipChange(false)).code).toBe('TIP_NO_CHANGE');
  expect(() => assertTipChange(true)).not.toThrow();
});

it('reports a stale revision before a no-change so identical racers conflict', () => {
  const stale = () => {
    assertTipRevision(2, 1);
    assertTipChange(false);
  };
  expect(thrown(stale).code).toBe('TIP_REVISION_CONFLICT');
});
