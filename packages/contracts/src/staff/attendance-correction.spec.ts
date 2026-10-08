import { expect, it } from 'vitest';
import { correctAttendanceInput, correctAttendanceResult } from './attendance-correction.js';

const valid = { revision: 0, reason: '  confirmed  ', clock_out: '2026-10-08T10:00:00.000Z' };
it('accepts either or both instants and trims the mandatory reason', () => {
  expect(correctAttendanceInput.parse(valid).reason).toBe('confirmed');
  expect(
    correctAttendanceInput.safeParse({ revision: 1, reason: 'x', clock_in: valid.clock_out })
      .success,
  ).toBe(true);
  expect(
    correctAttendanceInput.safeParse({ ...valid, clock_in: '2026-10-08T09:00:00Z' }).success,
  ).toBe(true);
  expect(correctAttendanceInput.safeParse({ ...valid, reason: 'x'.repeat(500) }).success).toBe(
    true,
  );
});

it.each([
  { revision: 0, reason: 'no times' },
  { ...valid, revision: -1 },
  { ...valid, revision: 0.5 },
  { ...valid, reason: '' },
  { ...valid, reason: '   ' },
  { ...valid, reason: 'x'.repeat(501) },
  { ...valid, clock_out: null },
  { ...valid, clock_out: '2026-10-08' },
  { ...valid, status: 'CLOSED' },
  { ...valid, actor_is_owner: true },
])('refuses malformed or client-controlled facts %#', (input) => {
  expect(correctAttendanceInput.safeParse(input).success).toBe(false);
});

it('rejects an open-session result', () => {
  const id = '01920000-0000-7000-8000-000000000001';
  expect(
    correctAttendanceResult.safeParse({
      session: {
        id,
        employee_id: id,
        branch_id: id,
        working_date: '2026-10-08',
        clock_in: '2026-10-08T09:00:00Z',
        clock_out: null,
        status: 'OPEN',
        closed_by: null,
        late_minutes: 0,
        revision: 0,
      },
      corrections: [],
    }).success,
  ).toBe(false);
});
