import { describe, expect, it } from 'vitest';

import {
  draftEquals,
  draftFromHours,
  draftProblem,
  payloadFromDraft,
  type HoursDraft,
} from './hours-draft';

const week = [
  { weekday: 1, intervals: [{ opens: '09:00', closes: '17:00' }] },
  {
    weekday: 3,
    intervals: [
      { opens: '09:00', closes: '12:00' },
      { opens: '14:00', closes: '20:00' },
    ],
  },
];

describe('hours draft', () => {
  it('turns the stored week into seven days and back without losing a period', () => {
    const draft = draftFromHours(week);
    expect(Object.keys(draft)).toHaveLength(7);
    expect(draft[2]).toEqual([]);
    expect(payloadFromDraft(draft)).toEqual(week);
  });

  it('reads no hours as a fully closed week', () => {
    expect(payloadFromDraft(draftFromHours(null))).toEqual([]);
  });

  it('finds no problem in a valid week, including one that crosses midnight', () => {
    expect(draftProblem(draftFromHours(week))).toBeNull();
    const overnight: HoursDraft = {
      ...draftFromHours(null),
      5: [{ opens: '18:00', closes: '02:00' }],
    };
    expect(draftProblem(overnight)).toBeNull();
  });

  it('reports an empty time, equal times and overlapping periods', () => {
    const base = draftFromHours(null);
    expect(draftProblem({ ...base, 2: [{ opens: '', closes: '10:00' }] })).toEqual({
      kind: 'incomplete',
      weekday: 2,
    });
    expect(draftProblem({ ...base, 4: [{ opens: '10:00', closes: '10:00' }] })).toEqual({
      kind: 'sameTimes',
      weekday: 4,
    });
    const overlapping = {
      ...base,
      1: [
        { opens: '09:00', closes: '13:00' },
        { opens: '12:00', closes: '15:00' },
      ],
    };
    expect(draftProblem(overlapping)).toEqual({ kind: 'overlap' });
  });

  it('reports an overnight period that runs into the next day first period', () => {
    const base = draftFromHours(null);
    const clash = {
      ...base,
      1: [{ opens: '22:00', closes: '03:00' }],
      2: [{ opens: '01:00', closes: '05:00' }],
    };
    expect(draftProblem(clash)).toEqual({ kind: 'overlap' });
  });

  it('compares drafts by meaning, ignoring how they were built', () => {
    expect(draftEquals(draftFromHours(week), draftFromHours([...week].reverse()))).toBe(true);
    expect(draftEquals(draftFromHours(week), draftFromHours(null))).toBe(false);
  });
});
