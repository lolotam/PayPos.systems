import { expect, it } from 'vitest';
import {
  isSamePerformerSet,
  planPerformersChange,
  type LinePerformerRow,
} from '../line-performers-plan.ts';
import { SessionError } from '../session-error.ts';
import type { SessionEmployee } from '../session-types.ts';

function employee(over: Partial<SessionEmployee> = {}): SessionEmployee {
  return {
    id: 'e1',
    name_en: 'Sara',
    name_ar: null,
    user_id: null,
    eligible: true,
    clocked_in: true,
    approved_leave: false,
    ...over,
  };
}

function row(over: Partial<LinePerformerRow> = {}): LinePerformerRow {
  return {
    employee_id: 'e1',
    performer_ordinal: 1,
    share_bps: 10000,
    name_en: 'Sara',
    name_ar: null,
    linked_user_id: null,
    linked_user_snapshotted: true,
    not_clocked_in_warning: false,
    approved_leave_warning: false,
    ...over,
  };
}

it('PC-03 swaps the performer and writes the new set only', () => {
  const plan = planPerformersChange({
    current: [row({ employee_id: 'sara', performer_ordinal: 1 })],
    requested: [{ employee_id: 'heba', share_bps: 10000 }],
    added_employees: [employee({ id: 'heba', name_en: 'Heba' })],
  });
  expect(plan.after).toHaveLength(1);
  expect(plan.after[0]?.employee_id).toBe('heba');
  expect(plan.after[0]?.name_en).toBe('Heba');
  expect(plan.kept_ids).toEqual([]);
  expect(plan.removed_ids).toEqual(['sara']);
  expect(plan.added_ids).toEqual(['heba']);
});

it('PC-03 adds a second performer and keeps the ordinals of the request', () => {
  const plan = planPerformersChange({
    current: [row({ employee_id: 'sara', performer_ordinal: 1 })],
    requested: [
      { employee_id: 'sara', share_bps: 7000 },
      { employee_id: 'rana', share_bps: 3000 },
    ],
    added_employees: [employee({ id: 'rana', name_en: 'Rana' })],
  });
  expect(plan.after.map((item) => [item.employee_id, item.performer_ordinal, item.share_bps])).toEqual([
    ['sara', 1, 7000],
    ['rana', 2, 3000],
  ]);
  expect(plan.kept_ids).toEqual(['sara']);
  expect(plan.added_ids).toEqual(['rana']);
  expect(plan.removed_ids).toEqual([]);
});

it('PC-03 removes a performer and names her in the old ordinal order', () => {
  const plan = planPerformersChange({
    current: [
      row({ employee_id: 'rana', performer_ordinal: 2, share_bps: 3000 }),
      row({ employee_id: 'sara', performer_ordinal: 1, share_bps: 7000 }),
    ],
    requested: [{ employee_id: 'sara', share_bps: 10000 }],
    added_employees: [],
  });
  expect(plan.after.map((item) => item.employee_id)).toEqual(['sara']);
  expect(plan.kept_ids).toEqual(['sara']);
  expect(plan.removed_ids).toEqual(['rana']);
});

it('PC-03 changes the shares only and copies the kept identity from the old row', () => {
  const plan = planPerformersChange({
    current: [
      row({ employee_id: 'sara', performer_ordinal: 1, share_bps: 5000, linked_user_id: 'u1' }),
      row({ employee_id: 'rana', performer_ordinal: 2, share_bps: 5000, name_en: 'Rana' }),
    ],
    requested: [
      { employee_id: 'sara', share_bps: 7000 },
      { employee_id: 'rana', share_bps: 3000 },
    ],
    added_employees: [
      employee({ id: 'sara', name_en: 'Another Sara', user_id: 'other-user', clocked_in: false }),
      employee({ id: 'rana', name_en: 'Another Rana', user_id: 'other-rana', approved_leave: true }),
    ],
  });
  expect(plan.after.map((item) => item.share_bps)).toEqual([7000, 3000]);
  expect(plan.after[0]).toMatchObject({
    name_en: 'Sara',
    linked_user_id: 'u1',
    not_clocked_in_warning: false,
    approved_leave_warning: false,
  });
  expect(plan.after[1]).toMatchObject({
    name_en: 'Rana',
    linked_user_id: null,
    not_clocked_in_warning: false,
    approved_leave_warning: false,
  });
  expect(plan.added_ids).toEqual([]);
  expect(plan.has_performer_warning).toBe(false);
});

it('PC-13 stores an added performer with her link at change time and no snapshot of a recording', () => {
  const plan = planPerformersChange({
    current: [],
    requested: [{ employee_id: 'heba', share_bps: 10000 }],
    added_employees: [employee({ id: 'heba', user_id: 'u9' })],
  });
  expect(plan.after[0]).toMatchObject({
    linked_user_id: 'u9',
    linked_user_snapshotted: true,
  });
});

it('PC-13 stores an added performer with no linked user as a null link and a true snapshot', () => {
  const plan = planPerformersChange({
    current: [],
    requested: [{ employee_id: 'heba', share_bps: 10000 }],
    added_employees: [employee({ id: 'heba', user_id: null })],
  });
  expect(plan.after[0]).toMatchObject({
    linked_user_id: null,
    linked_user_snapshotted: true,
  });
});

it('PC-13 and D-5 keep the recording-time snapshot of a performer who stays', () => {
  const plan = planPerformersChange({
    current: [
      row({
        employee_id: 'sara',
        name_en: 'Sara',
        name_ar: 'سارة',
        linked_user_id: 'old-user',
        linked_user_snapshotted: true,
        not_clocked_in_warning: false,
        approved_leave_warning: false,
      }),
    ],
    requested: [{ employee_id: 'sara', share_bps: 10000 }],
    added_employees: [
      employee({
        id: 'sara',
        name_en: 'Another Sara',
        name_ar: 'سارة أخرى',
        user_id: 'new-user',
        clocked_in: false,
        approved_leave: true,
      }),
    ],
  });
  expect(plan.after[0]).toMatchObject({
    name_en: 'Sara',
    name_ar: 'سارة',
    linked_user_id: 'old-user',
    linked_user_snapshotted: true,
    not_clocked_in_warning: false,
    approved_leave_warning: false,
  });
  expect(plan.has_performer_warning).toBe(false);
});

it('PC-06 raises the line flag for the warnings of an added performer', () => {
  const plan = planPerformersChange({
    current: [],
    requested: [{ employee_id: 'heba', share_bps: 10000 }],
    added_employees: [employee({ id: 'heba', clocked_in: false })],
  });
  expect(plan.after[0]?.not_clocked_in_warning).toBe(true);
  expect(plan.has_performer_warning).toBe(true);
});

it('PC-06 keeps the flags of a performer who stays and raises the line flag with them', () => {
  const plan = planPerformersChange({
    current: [row({ employee_id: 'sara', approved_leave_warning: true })],
    requested: [{ employee_id: 'sara', share_bps: 10000 }],
    added_employees: [],
  });
  expect(plan.after[0]?.approved_leave_warning).toBe(true);
  expect(plan.has_performer_warning).toBe(true);
});

it('PC-06 clears the line flag when the warned performer is removed', () => {
  const plan = planPerformersChange({
    current: [
      row({ employee_id: 'sara', performer_ordinal: 1, approved_leave_warning: true }),
      row({ employee_id: 'rana', performer_ordinal: 2 }),
    ],
    requested: [{ employee_id: 'rana', share_bps: 10000 }],
    added_employees: [],
  });
  expect(plan.after[0]?.approved_leave_warning).toBe(false);
  expect(plan.has_performer_warning).toBe(false);
});

it('refuses an added performer whose facts are missing', () => {
  try {
    planPerformersChange({
      current: [],
      requested: [{ employee_id: 'ghost', share_bps: 10000 }],
      added_employees: [],
    });
    throw new Error('expected a SessionError');
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).code).toBe('SESSION_PERFORMER_NOT_ELIGIBLE');
    expect((error as SessionError).details).toEqual({ employee_ids: ['ghost'] });
  }
});

it('PC-03 treats a reordering of the same performers as the same set', () => {
  const current = [
    { employee_id: 'sara', share_bps: 7000 },
    { employee_id: 'rana', share_bps: 3000 },
  ];
  expect(
    isSamePerformerSet(current, [
      { employee_id: 'rana', share_bps: 3000 },
      { employee_id: 'sara', share_bps: 7000 },
    ]),
  ).toBe(true);
});

it('PC-03 tells a changed share, a changed member and a different size apart from the same set', () => {
  const current = [{ employee_id: 'sara', share_bps: 10000 }];
  expect(isSamePerformerSet(current, [{ employee_id: 'sara', share_bps: 7000 }])).toBe(false);
  expect(isSamePerformerSet(current, [{ employee_id: 'rana', share_bps: 10000 }])).toBe(false);
  expect(
    isSamePerformerSet(current, [
      { employee_id: 'sara', share_bps: 5000 },
      { employee_id: 'rana', share_bps: 5000 },
    ]),
  ).toBe(false);
});
