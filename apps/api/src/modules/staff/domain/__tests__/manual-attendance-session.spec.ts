import { expect, it } from 'vitest';
import { planManualSession, type ManualSessionContext } from '../manual-attendance-session.ts';

const input = {
  branch_id: 'branch',
  clock_in: '2026-10-08T07:00:00.000Z',
  clock_out: '2026-10-08T16:00:00.000Z',
};
const context: ManualSessionContext = {
  now: new Date('2026-10-10T20:00:00Z'),
  timezone: 'Asia/Kuwait',
  employee: {
    hire_date: '2000-01-01',
    contract_end: null,
    attachments: [{ branch_id: 'branch', from: '2000-01-01', to: null }],
  },
  shifts: [],
  neighbours: [],
  pending: [],
  selfRequestId: 'self',
};
it('echoes UTC times, stores no schedule and computes Kuwait date including overnight', () => {
  expect(planManualSession(input, context)).toEqual({
    clock_in: input.clock_in,
    clock_out: input.clock_out,
    working_date: '2026-10-08',
    timezone: 'Asia/Kuwait',
    late_minutes: 0,
    scheduled_start: null,
    scheduled_end: null,
  });
  for (const [start, end, date] of [
    ['2026-10-08T19:00:00Z', '2026-10-08T23:00:00Z', '2026-10-08'],
    ['2026-10-08T21:30:00Z', '2026-10-09T01:00:00Z', '2026-10-09'],
  ] as const)
    expect(
      planManualSession({ ...input, clock_in: start, clock_out: end }, context).working_date,
    ).toBe(date);
});
it.each([10, 11])('uses the full lateness after the ten-minute grace (%s)', (minutes) => {
  const startsAt = new Date('2026-10-08T07:00:00Z');
  const shifts = [{ startsAt, endsAt: new Date(input.clock_out), workingDate: '2026-10-08' }];
  const plan = planManualSession(
    { ...input, clock_in: new Date(+startsAt + minutes * 60000).toISOString() },
    { ...context, shifts },
  );
  expect(plan.late_minutes).toBe(minutes === 10 ? 0 : 11);
  expect(plan.scheduled_start).toBe(startsAt.toISOString());
});
it('picks a covering shift before the first start of the day', () => {
  const early = {
    startsAt: new Date('2026-10-08T01:00:00Z'),
    endsAt: new Date('2026-10-08T02:00:00Z'),
    workingDate: '2026-10-08',
  };
  const covering = {
    ...early,
    startsAt: new Date(input.clock_in),
    endsAt: new Date(input.clock_out),
  };
  expect(planManualSession(input, { ...context, shifts: [early, covering] }).scheduled_start).toBe(
    input.clock_in,
  );
  expect(planManualSession(input, { ...context, shifts: [early] }).scheduled_start).toBe(
    early.startsAt.toISOString(),
  );
});
it.each([
  { clock_out: input.clock_in },
  { clock_out: '2026-10-08T06:59:59.999Z' },
  { clock_out: '2026-10-08T23:00:00.001Z' },
  { clock_out: '2026-10-10T20:00:00.001Z' },
  { clock_in: '2026-10-10T20:00:00.001Z', clock_out: '2026-10-10T21:00:00Z' },
])('refuses bad times before eligibility', (patch) => {
  expect(() =>
    planManualSession(
      { ...input, ...patch },
      { ...context, employee: { ...context.employee, attachments: [] } },
    ),
  ).toThrow('ATTENDANCE_MANUAL_INVALID_TIMES');
});
it('accepts exactly sixteen hours and very old dates', () => {
  expect(planManualSession({ ...input, clock_out: '2026-10-08T23:00:00Z' }, context)).toBeDefined();
  expect(
    planManualSession(
      { ...input, clock_in: '2001-01-01T07:00:00Z', clock_out: '2001-01-01T08:00:00Z' },
      context,
    ),
  ).toBeDefined();
});
it.each([
  { attachments: [] },
  { attachments: [{ branch_id: 'branch', from: '2000-01-01', to: '2026-10-08' }] },
  { hire_date: '2026-10-09' },
  { contract_end: '2026-10-07' },
])('refuses historical ineligibility', (patch) => {
  expect(() =>
    planManualSession(input, { ...context, employee: { ...context.employee, ...patch } }),
  ).toThrow('ATTENDANCE_MANUAL_NOT_ELIGIBLE');
});
it('allows the inclusive contract end and exclusive touching intervals', () => {
  const neighbours = [{ id: 'other', clock_in: input.clock_out, clock_out: null }];
  expect(
    planManualSession(input, {
      ...context,
      neighbours,
      employee: { ...context.employee, contract_end: '2026-10-08' },
    }),
  ).toBeDefined();
});
it('rejects overlapping sessions including open ones, ignoring voided ones', () => {
  const other = { id: 'other', clock_in: '2026-10-08T06:00:00Z', clock_out: null };
  expect(() => planManualSession(input, { ...context, neighbours: [other] })).toThrow(
    'ATTENDANCE_MANUAL_INVALID_TIMES',
  );
  expect(() =>
    planManualSession(input, {
      ...context,
      neighbours: [{ ...other, clock_out: '2026-10-08T07:00:00.001Z' }],
    }),
  ).toThrow('ATTENDANCE_MANUAL_INVALID_TIMES');
  expect(
    planManualSession(input, {
      ...context,
      neighbours: [{ ...other, voided_at: '2026-10-09T00:00:00Z' }],
    }),
  ).toBeDefined();
});
it('rejects another pending ADD but excludes its own request at approval', () => {
  const pending = [{ id: 'other', clock_in: input.clock_in, clock_out: input.clock_out }];
  expect(() => planManualSession(input, { ...context, pending })).toThrow(
    'ATTENDANCE_CHANGE_DUPLICATE_PENDING',
  );
  expect(planManualSession(input, { ...context, pending, selfRequestId: 'other' })).toBeDefined();
});
it('refuses a branch time-zone change after filing with its own code, not invalid times', () => {
  expect(() =>
    planManualSession(input, {
      ...context,
      timezone: 'UTC',
      stored: { working_date: '2026-10-08', timezone: 'Asia/Kuwait' },
    }),
  ).toThrow(expect.objectContaining({ code: 'ATTENDANCE_MANUAL_TIMEZONE_CHANGED' }));
  expect(
    planManualSession(input, {
      ...context,
      stored: { working_date: '2026-10-08', timezone: 'Asia/Kuwait' },
    }).timezone,
  ).toBe('Asia/Kuwait');
});
