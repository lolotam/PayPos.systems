import { describe, expect, it } from 'vitest';
import { validateTipSet } from '../tip-set.ts';
import { codeOf, entry, person } from './fixtures/tip-set.ts';

const cashier = 'cashier';

describe('validateTipSet duplicate people', () => {
  it('keeps an unsnapshotted row when the same employee is listed again', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [
            person('sara', { snapshotted: false, linked: 'other' }),
            person('sara', { snapshotted: true, linked: null }),
          ],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });

  it('keeps the actor link when it appears only on the second row', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [
            person('sara', { linked: null, current: null }),
            person('sara', { linked: null, current: 'actor' }),
          ],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });

  it('treats the employee as active when only one row has an active line', () => {
    const requested = [entry('sara', 'CASH', 1n)];
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [],
      requested,
      people: [
        person('sara', { active: true, linked: 'other' }),
        person('sara', { active: false, linked: 'other' }),
      ],
    });
    expect(result.added).toEqual(requested);
  });
});

describe('validateTipSet duplicate people case and conflict', () => {
  it('merges case-variant ids into one employee', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [],
          requested: [entry('SARA', 'CASH', 1n)],
          people: [
            person('Sara', { snapshotted: false, active: false }),
            person('sara', { snapshotted: true, active: true, linked: null }),
          ],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });

  it('fails closed when two rows name different current users', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'two',
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [person('sara', { current: 'one' }), person('sara', { current: 'two' })],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });
});

describe('validateTipSet duplicate people with a missing identity', () => {
  it('keeps the missing-identity evidence when another row of the same employee has a snapshot', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [
            person('sara', { identities: [] }),
            person('sara', { snapshotted: true, linked: null }),
          ],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });
});
