import { expect, it } from 'vitest';
import type { LinePerformerRow } from '../line-performers-plan.ts';
import {
  prepareLinePerformersChange,
  type PerformersLineState,
  type PrepareLinePerformersInput,
} from '../line-performers-prepare.ts';
import { SessionError } from '../session-error.ts';
import type { SessionEmployee } from '../session-types.ts';

const now = new Date('2026-10-17T08:00:00.000Z');

function line(over: Partial<PerformersLineState> = {}): PerformersLineState {
  return { status: 'ACTIVE', revision: 1, not_changeable: false, ...over };
}

function row(over: Partial<LinePerformerRow> = {}): LinePerformerRow {
  return {
    employee_id: 'sara',
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

function employee(over: Partial<SessionEmployee> = {}): SessionEmployee {
  return {
    id: 'sara',
    name_en: 'Sara',
    name_ar: null,
    user_id: null,
    eligible: true,
    clocked_in: true,
    approved_leave: false,
    ...over,
  };
}

function input(over: Partial<PrepareLinePerformersInput> = {}): PrepareLinePerformersInput {
  return {
    line: line(),
    expected_revision: 1,
    business_date: '2026-10-12',
    now,
    business_timezone: 'Asia/Kuwait',
    reason: 'رنا شاركت في الشطف',
    current_performers: [row()],
    requested_performers: [
      { employee_id: 'sara', share_bps: 7000 },
      { employee_id: 'rana', share_bps: 3000 },
    ],
    added_employees: [employee({ id: 'rana', name_en: 'Rana' })],
    ...over,
  };
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

const stacked = {
  business_date: '2026-08-31',
  reason: '   ',
  requested_performers: [],
  added_employees: [],
};

it('accepts a change, adds a version and never touches the money', () => {
  const result = prepareLinePerformersChange(input());
  expect(result.revision).toBe(2);
  expect(result.reason).toBe('رنا شاركت في الشطف');
  expect(result.previous).toEqual({
    revision: 1,
    performers: [{ employee_id: 'sara', share_bps: 10000 }],
  });
  expect(result.after.map((item) => [item.employee_id, item.performer_ordinal, item.share_bps])).toEqual([
    ['sara', 1, 7000],
    ['rana', 2, 3000],
  ]);
  expect(result.kept_ids).toEqual(['sara']);
  expect(result.added_ids).toEqual(['rana']);
  expect(result.removed_ids).toEqual([]);
  expect(result.has_performer_warning).toBe(false);
  expect(result).not.toHaveProperty('price');
  expect(result).not.toHaveProperty('discount');
  expect(result).not.toHaveProperty('net');
  expect(result).not.toHaveProperty('status');
});

it('PC-21 refuses a stale revision before every later refusal', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        ...stacked,
        line: line({ status: 'CANCELLED', revision: 4, not_changeable: true }),
        expected_revision: 3,
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_REVISION_STALE');
  expect(error.details).toEqual({ current_revision: 4 });
});

it('FR-011 refuses a cancelled line before the reserved marker', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        ...stacked,
        line: line({ status: 'CANCELLED', revision: 4, not_changeable: true }),
        expected_revision: 4,
      }),
    ),
  );
  expect(error.code).toBe('SESSION_LINE_NOT_EDITABLE');
});

it('FR-011 refuses the reserved marker before the window', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(input({ ...stacked, line: line({ not_changeable: true }) })),
  );
  expect(error.code).toBe('SESSION_LINE_PERFORMERS_NOT_CHANGEABLE');
});

it('PC-14 refuses a closed window before the reason', () => {
  const error = thrown(() => prepareLinePerformersChange(input(stacked)));
  expect(error.code).toBe('SESSION_TIME_TOO_OLD');
});

it('FR-011 refuses an invalid reason before the shape of the set', () => {
  const error = thrown(() => prepareLinePerformersChange(input({ ...stacked, business_date: '2026-10-12' })));
  expect(error.code).toBe('SESSION_PERFORMERS_REASON_INVALID');
});

it('FR-011 refuses an invalid set before the eligibility of the additions', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        business_date: '2026-10-12',
        reason: 'سبب',
        requested_performers: [
          { employee_id: 'ghost', share_bps: 6000 },
          { employee_id: 'sara', share_bps: 3000 },
        ],
        added_employees: [],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_SHARES_INVALID');
  expect(error.details).toBeUndefined();
});

it('PC-05 refuses an ineligible addition with the employee ids in the request order', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        added_employees: [
          employee({ id: 'rana', name_en: 'Rana', eligible: false }),
          employee({ id: 'heba', name_en: 'Heba', eligible: false }),
        ],
        requested_performers: [
          { employee_id: 'heba', share_bps: 3000 },
          { employee_id: 'rana', share_bps: 7000 },
        ],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_NOT_ELIGIBLE');
  expect(error.details).toEqual({ employee_ids: ['heba', 'rana'] });
});

it('PC-05 refuses an addition whose facts are missing', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({ requested_performers: [{ employee_id: 'ghost', share_bps: 10000 }], added_employees: [] }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMER_NOT_ELIGIBLE');
  expect(error.details).toEqual({ employee_ids: ['ghost'] });
});

it('PC-05 and D-11 keep a performer who stays even when she is no longer eligible', () => {
  const result = prepareLinePerformersChange(
    input({
      current_performers: [row({ employee_id: 'sara', share_bps: 10000 })],
      requested_performers: [
        { employee_id: 'sara', share_bps: 7000 },
        { employee_id: 'rana', share_bps: 3000 },
      ],
      added_employees: [
        employee({ id: 'sara', eligible: false }),
        employee({ id: 'rana', name_en: 'Rana' }),
      ],
    }),
  );
  expect(result.kept_ids).toEqual(['sara']);
  expect(result.added_ids).toEqual(['rana']);
});

it('PC-05 and D-11 keep a performer who stays even when her facts are gone', () => {
  const result = prepareLinePerformersChange(
    input({
      current_performers: [row({ employee_id: 'sara', share_bps: 10000 })],
      requested_performers: [
        { employee_id: 'sara', share_bps: 7000 },
        { employee_id: 'rana', share_bps: 3000 },
      ],
      added_employees: [employee({ id: 'rana', name_en: 'Rana' })],
    }),
  );
  expect(result.kept_ids).toEqual(['sara']);
  expect(result.added_ids).toEqual(['rana']);
});

it('FR-011 refuses an unchanged set after the other rules passed', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        current_performers: [row({ employee_id: 'sara', share_bps: 10000 })],
        requested_performers: [{ employee_id: 'sara', share_bps: 10000 }],
        added_employees: [],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMERS_NO_CHANGE');
});

it('PC-03 refuses a reordering of the same performers as an unchanged set', () => {
  const error = thrown(() =>
    prepareLinePerformersChange(
      input({
        current_performers: [
          row({ employee_id: 'sara', performer_ordinal: 1, share_bps: 7000 }),
          row({ employee_id: 'rana', performer_ordinal: 2, share_bps: 3000, name_en: 'Rana' }),
        ],
        requested_performers: [
          { employee_id: 'rana', share_bps: 3000 },
          { employee_id: 'sara', share_bps: 7000 },
        ],
        added_employees: [],
      }),
    ),
  );
  expect(error.code).toBe('SESSION_PERFORMERS_NO_CHANGE');
});

it('PC-04 refuses zero, five and duplicate performers', () => {
  const five = Array.from({ length: 5 }, (_, index) => ({ employee_id: `e${index}`, share_bps: 2000 }));
  for (const performers of [
    [],
    five,
    [
      { employee_id: 'sara', share_bps: 5000 },
      { employee_id: 'sara', share_bps: 5000 },
    ],
  ]) {
    const error = thrown(() =>
      prepareLinePerformersChange(input({ requested_performers: performers, added_employees: [] })),
    );
    expect(error.code).toBe('SESSION_PERFORMER_SHARES_INVALID');
    expect(error.details).toBeUndefined();
  }
});

it('PC-04 refuses an omitted share beside an explicit one, a zero, a fractional and a wrong sum', () => {
  for (const performers of [
    [{ employee_id: 'sara', share_bps: 7000 }, { employee_id: 'rana' }],
    [{ employee_id: 'sara', share_bps: 0 }, { employee_id: 'rana', share_bps: 10000 }],
    [{ employee_id: 'sara', share_bps: 5000.5 }, { employee_id: 'rana', share_bps: 4999.5 }],
    [{ employee_id: 'sara', share_bps: 6000 }, { employee_id: 'rana', share_bps: 3000 }],
  ]) {
    const error = thrown(() =>
      prepareLinePerformersChange(input({ requested_performers: performers, added_employees: [] })),
    );
    expect(error.code).toBe('SESSION_PERFORMER_SHARES_INVALID');
    expect(error.details).toBeUndefined();
  }
});

it('PC-04 splits three performers equally and gives the remainder to the first', () => {
  const result = prepareLinePerformersChange(
    input({
      requested_performers: [{ employee_id: 'sara' }, { employee_id: 'rana' }, { employee_id: 'heba' }],
      added_employees: [
        employee({ id: 'rana', name_en: 'Rana' }),
        employee({ id: 'heba', name_en: 'Heba' }),
      ],
    }),
  );
  expect(result.after.map((item) => item.share_bps)).toEqual([3334, 3333, 3333]);
});

it('PC-14 accepts the first day of the previous month', () => {
  const result = prepareLinePerformersChange(input({ business_date: '2026-09-01' }));
  expect(result.revision).toBe(2);
});

it('PC-16 trims the reason and keeps it out of the plan', () => {
  const result = prepareLinePerformersChange(input({ reason: ' \tرنا شاركت في الشطف\r\n ' }));
  expect(result.reason).toBe('رنا شاركت في الشطف');
  expect(JSON.stringify(result.after)).not.toContain('رنا شاركت');
});

it('reads the previous performers in the old ordinal order, not in the request order', () => {
  const result = prepareLinePerformersChange(
    input({
      current_performers: [
        row({ employee_id: 'rana', performer_ordinal: 2, share_bps: 3000, name_en: 'Rana' }),
        row({ employee_id: 'sara', performer_ordinal: 1, share_bps: 7000 }),
      ],
      requested_performers: [
        { employee_id: 'sara', share_bps: 6000 },
        { employee_id: 'rana', share_bps: 4000 },
      ],
      added_employees: [],
    }),
  );
  expect(result.previous.performers).toEqual([
    { employee_id: 'sara', share_bps: 7000 },
    { employee_id: 'rana', share_bps: 3000 },
  ]);
});

it('PC-06 raises the line flag from the warnings of the added performer', () => {
  const result = prepareLinePerformersChange(
    input({
      added_employees: [employee({ id: 'rana', name_en: 'Rana', clocked_in: false })],
    }),
  );
  expect(result.after[1]?.not_clocked_in_warning).toBe(true);
  expect(result.has_performer_warning).toBe(true);
});
