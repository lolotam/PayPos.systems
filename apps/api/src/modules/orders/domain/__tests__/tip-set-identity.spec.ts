import { MONEY_MAX } from '@pospay/domain';
import { describe, expect, it } from 'vitest';
import { validateTipSet, type TipSetInput } from '../tip-set.ts';
import { codeOf, entry, person } from './fixtures/tip-set.ts';

const cashier = 'cashier';

describe('validateTipSet self rule', () => {
  it('refuses a tip matched by the performer snapshot', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'Actor',
          current: [],
          requested: [entry('sara', 'CARD', 6_000n)],
          people: [person('sara', { linked: 'actor', current: 'someone-else' })],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });

  it('refuses a tip matched by the current user link', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [person('sara', { linked: 'old-user', current: 'ACTOR' })],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });

  it('refuses a removed performer when the retained snapshot is the actor', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('sara', 'CASH', 1n)],
          people: [person('sara', { active: false, linked: 'actor' })],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });

  it('refuses removal of her own entry', () => {
    const own = entry('sara', 'CARD', 1_000n);
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [own],
          requested: [],
          people: [person('sara', { linked: 'actor' })],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });
});

describe('validateTipSet self rule exceptions', () => {
  it('does not treat a null link as the actor', () => {
    const requested = [entry('sara', 'CASH', 1n)];
    const result = validateTipSet({
      actor_user_id: 'actor',
      current: [],
      requested,
      people: [person('sara', { linked: null, current: null })],
    });
    expect(result.added).toEqual(requested);
  });

  it('lets the actor keep her own entry unchanged and record someone else', () => {
    const own = entry('sara', 'CARD', 6_000n);
    const other = entry('heba', 'CARD', 2_000n);
    const result = validateTipSet({
      actor_user_id: 'sara-user',
      current: [own],
      requested: [other, own],
      people: [person('sara', { linked: 'sara-user' }), person('heba')],
    });
    expect(result.carried).toEqual([own]);
    expect(result.added).toEqual([other]);
  });
});

describe('validateTipSet unsnapshotted identity', () => {
  const kept = entry('old', 'CARD', 1_000n);
  const people = [
    person('old', { snapshotted: false, linked: 'actor', active: true }),
    person('heba'),
  ];

  it('refuses add, change and removal for a manager and for the linked actor', () => {
    for (const actor_user_id of ['manager', 'actor']) {
      const inputs: TipSetInput[] = [
        { actor_user_id, current: [], requested: [entry('old', 'CASH', 1n)], people },
        { actor_user_id, current: [kept], requested: [entry('old', 'CARD', 2n)], people },
        { actor_user_id, current: [kept], requested: [], people },
      ];
      for (const input of inputs) {
        expect(codeOf(() => validateTipSet(input))).toBe('TIP_IDENTITY_UNKNOWN');
      }
    }
  });

  it('fails closed when any identity row of that employee is unsnapshotted', () => {
    const mixed = [
      person('old', {
        identities: [
          { linked_user_id: 'other', linked_user_snapshotted: true },
          { linked_user_id: null, linked_user_snapshotted: false },
        ],
      }),
    ];
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'manager',
          current: [],
          requested: [entry('old', 'CASH', 1n)],
          people: mixed,
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });
});

describe('validateTipSet carried unsnapshotted entry', () => {
  it('accepts another employee in the same request when the unsnapshotted entry is carried', () => {
    const kept = entry('old', 'CARD', 1_000n);
    const added = entry('heba', 'CASH', 500n);
    const people = [
      person('old', { snapshotted: false, linked: 'actor', active: true }),
      person('heba'),
    ];
    for (const actor_user_id of ['manager', 'actor']) {
      const result = validateTipSet({
        actor_user_id,
        current: [kept],
        requested: [kept, added],
        people,
      });
      expect(result.carried).toEqual([kept]);
      expect(result.added).toEqual([added]);
      expect(result.changed).toEqual([]);
      expect(result.removed).toEqual([]);
    }
  });
});

describe('validateTipSet line-less performer', () => {
  it('keeps a carried tip of a line-less performer, refuses a change, and allows removal', () => {
    const current = entry('sara', 'CASH', 1_000n);
    const people = [person('sara', { active: false, linked: 'other' })];
    const carried = validateTipSet({
      actor_user_id: cashier,
      current: [current],
      requested: [current],
      people,
    });
    expect(carried.changed_anything).toBe(false);
    expect(carried.carried).toEqual([current]);
    const changed = () =>
      validateTipSet({
        actor_user_id: cashier,
        current: [current],
        requested: [entry('sara', 'CASH', 1_500n)],
        people,
      });
    expect(codeOf(changed)).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
    const removed = validateTipSet({
      actor_user_id: cashier,
      current: [current],
      requested: [],
      people,
    });
    expect(removed.removed).toEqual([current]);
    expect(removed.total_cash).toBe(0n);
    expect(removed.changed_anything).toBe(true);
  });
});

describe('validateTipSet missing performers', () => {
  it('refuses an added entry for an employee who never performed', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [],
          requested: [entry('ghost', 'CASH', 1n)],
          people: [person('sara')],
        }),
      ),
    ).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
  });

  it('refuses removal of an entry whose employee is absent from people', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [entry('ghost', 'CARD', 1n)],
          requested: [],
          people: [person('sara')],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
  });
});

describe('validateTipSet refusal order', () => {
  it('refuses shape before unknown identity, and unknown identity before self', () => {
    const self = person('self', { linked: 'actor', active: false });
    const old = person('old', { snapshotted: false, linked: 'actor' });
    const live = person('live');
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('self', 'CASH', 0n)],
          people: [self],
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('old', 'CASH', 1n)],
          people: [old],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: 'actor',
          current: [],
          requested: [entry('self', 'CASH', MONEY_MAX), entry('live', 'CASH', 1n)],
          people: [self, live],
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });
});

describe('validateTipSet later refusals', () => {
  it('refuses an unknown removal before a non-performer, and a non-performer before the total', () => {
    const idle = person('idle', { active: false, linked: 'other' });
    const live = person('live');
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [entry('ghost', 'CASH', 1n)],
          requested: [entry('idle', 'CASH', MONEY_MAX), entry('live', 'CASH', 1n)],
          people: [idle, live],
        }),
      ),
    ).toBe('TIP_IDENTITY_UNKNOWN');
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: cashier,
          current: [],
          requested: [entry('idle', 'CASH', MONEY_MAX), entry('live', 'CASH', 1n)],
          people: [idle, live],
        }),
      ),
    ).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
  });
});

describe('validateTipSet empty identity', () => {
  const people = [person('sara', { identities: [], active: false }), person('heba')];
  const current = entry('sara', 'CASH', 1_000n);

  it('refuses add, change and removal when the performer has no identity row', () => {
    const inputs: TipSetInput[] = [
      { actor_user_id: cashier, current: [], requested: [entry('sara', 'CASH', 1n)], people },
      {
        actor_user_id: cashier,
        current: [current],
        requested: [entry('sara', 'CASH', 2n)],
        people,
      },
      { actor_user_id: cashier, current: [current], requested: [], people },
    ];
    for (const input of inputs) {
      expect(codeOf(() => validateTipSet(input))).toBe('TIP_IDENTITY_UNKNOWN');
    }
  });

  it('accepts an untouched entry of an employee with no identity row', () => {
    const added = entry('heba', 'CARD', 500n);
    const result = validateTipSet({
      actor_user_id: cashier,
      current: [current],
      requested: [current, added],
      people,
    });
    expect(result.carried).toEqual([current]);
    expect(result.added).toEqual([added]);
  });
});
