import { describe, expect, it } from 'vitest';
import { retainedTipRows, withCurrentLinks } from '../tip-people-links.ts';
import { validateTipSet } from '../tip-set.ts';
import { codeOf, entry } from './fixtures/tip-set.ts';

const sara = '01990000-0000-7000-8000-00000000000b';
const actor = '01990000-0000-7000-8000-0000000000d1';
const manager = '01990000-0000-7000-8000-0000000000d2';
const retained = [{ employee_id: sara, linked_user_id: actor, linked_user_snapshotted: true }];

describe('retainedTipRows', () => {
  it('returns no rows for an empty history', () => {
    expect(retainedTipRows([])).toEqual([]);
  });

  it('marks the removed performer as having no active line', () => {
    const rows = retainedTipRows(retained);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.has_active_line).toBe(false);
  });

  it('copies the recorded snapshot unchanged', () => {
    expect(retainedTipRows(retained)).toEqual([
      { employee_id: sara, has_active_line: false, identities: [{ linked_user_id: actor, linked_user_snapshotted: true }] },
    ]);
    expect(retainedTipRows([{ employee_id: sara, linked_user_id: null, linked_user_snapshotted: false }])).toEqual([
      { employee_id: sara, has_active_line: false, identities: [{ linked_user_id: null, linked_user_snapshotted: false }] },
    ]);
  });
});

describe('a retained performer in the tip rules', () => {
  const people = (currentUser: string | null = null) =>
    withCurrentLinks(retainedTipRows(retained), [{ id: sara, user_id: currentUser }], [sara]);

  it('refuses her own removal when the retained snapshot is the actor', () => {
    const kept = entry(sara, 'CASH', 1_000n);
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: actor,
          current: [kept],
          requested: [],
          people: people(),
        }),
      ),
    ).toBe('TIP_SELF_FORBIDDEN');
  });

  it('lets another actor remove her entry', () => {
    const kept = entry(sara, 'CASH', 1_000n);
    const result = validateTipSet({
      actor_user_id: manager,
      current: [kept],
      requested: [],
      people: people(),
    });
    expect(result.removed).toEqual([kept]);
    expect(result.changed_anything).toBe(true);
  });

  it('refuses a new tip for her while she has no active line', () => {
    expect(
      codeOf(() =>
        validateTipSet({
          actor_user_id: manager,
          current: [],
          requested: [entry(sara, 'CARD', 1_000n)],
          people: people(),
        }),
      ),
    ).toBe('TIP_EMPLOYEE_NOT_PERFORMER');
  });

  it('accepts a new tip for her while she still performs another active line', () => {
    const rows = [
      ...retainedTipRows(retained),
      { employee_id: sara, has_active_line: true, identities: [{ linked_user_id: actor, linked_user_snapshotted: true }] },
    ];
    const requested = entry(sara, 'CARD', 1_000n);
    const result = validateTipSet({
      actor_user_id: manager,
      current: [],
      requested: [requested],
      people: withCurrentLinks(rows, [{ id: sara, user_id: null }], [sara]),
    });
    expect(result.added).toEqual([requested]);
  });
});
