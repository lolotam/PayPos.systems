import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceFixture,
  seedAttendanceBreak,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';

let f: AttendanceFixture;
beforeAll(async () => {
  f = await attendanceFixture();
  await f.owner`UPDATE memberships SET starts_at='2026-01-01' WHERE id=${f.membershipId}`;
  await f.owner`UPDATE branches SET geo_lat=29.3,geo_lng=47.9 WHERE id=${f.branchId}`;
});
afterAll(async () => {
  await f?.close();
});

async function clock(date: string, time: string) {
  f.setNow(new Date(`${date}T${time}:00+03:00`));
  return (
    await f.prepare({ ...f.scan(), location: { lat: 29.3, lng: 47.9, accuracy: 0 } })
  ).execute();
}

it.each([
  ['2026-10-03', '14:05', 0],
  ['2026-10-10', '14:12', 12],
] as const)('BW-07 QR return on %s at %s stores %i late minutes', async (date, time, late) => {
  await seedAttendanceBreak(f, date);
  expect(await clock(date, '08:58')).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 0 });
  expect(await clock(date, '13:00')).toMatchObject({ operation: 'CLOCK_OUT', late_minutes: 0 });
  const returned = await clock(date, time);
  expect(returned).toMatchObject({ operation: 'CLOCK_IN', late_minutes: late, exceptions: [] });
  const rows =
    await f.owner`SELECT scheduled_start,scheduled_end,late_minutes FROM attendance_sessions WHERE id=${returned.session_id}`;
  expect(rows).toMatchObject([
    {
      scheduled_start: new Date(`${date}T14:00:00+03:00`),
      scheduled_end: new Date(`${date}T17:00:00+03:00`),
      late_minutes: late,
    },
  ]);
  expect(await clock(date, '17:00')).toMatchObject({ operation: 'CLOCK_OUT', late_minutes: late });
});

it('BW-07 QR first arrival after break start is still late from 09:00', async () => {
  const date = '2026-10-17';
  await seedAttendanceBreak(f, date);
  const first = await clock(date, '13:30');
  expect(first).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 270 });
  expect(
    await f.owner`SELECT scheduled_start FROM attendance_sessions WHERE id=${first.session_id}`,
  ).toMatchObject([{ scheduled_start: new Date(`${date}T09:00:00+03:00`) }]);
  await clock(date, '17:00');
});

it('BW-07 QR needs no break clocking and creates no exception or alert', async () => {
  const date = '2026-10-24';
  await seedAttendanceBreak(f, date);
  const first = await clock(date, '08:58');
  const closed = await clock(date, '17:00');
  expect(closed).toMatchObject({
    session_id: first.session_id,
    operation: 'CLOCK_OUT',
    late_minutes: 0,
    exceptions: [],
  });
  expect(
    await f.owner`SELECT id FROM attendance_exceptions WHERE session_id=${first.session_id}`,
  ).toHaveLength(0);
  const events =
    await f.owner`SELECT event_type FROM outbox WHERE payload->>'session_id'=${first.session_id} ORDER BY created_at,id`;
  expect(events.map((row) => row.event_type)).toEqual([
    'AttendanceClockedIn',
    'AttendanceClockedOut',
  ]);
});

it('BW-07 QR first arrival after a worker MISSED_OUT close is not a return', async () => {
  const date = '2026-10-31';
  await seedAttendanceBreak(f, date);
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},'2026-10-30','Asia/Kuwait',
      '2026-10-30T18:00:00+03:00','2026-10-31T10:00:00+03:00','MISSED_OUT','QR','MISSED_OUT','OK',0)`;
  const first = await clock(date, '13:30');
  expect(first).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 270 });
  expect(
    await f.owner`SELECT scheduled_start FROM attendance_sessions WHERE id=${first.session_id}`,
  ).toMatchObject([{ scheduled_start: new Date(`${date}T09:00:00+03:00`) }]);
  await clock(date, '17:00');
});

it('BW-07 QR clock-out for the break without a return keeps the morning lateness', async () => {
  const date = '2026-11-07';
  await seedAttendanceBreak(f, date);
  const first = await clock(date, '09:20');
  expect(first).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 20 });
  expect(await clock(date, '13:00')).toMatchObject({
    session_id: first.session_id,
    operation: 'CLOCK_OUT',
    late_minutes: 20,
    exceptions: [],
  });
  expect(
    await f.owner`SELECT id FROM attendance_exceptions WHERE session_id=${first.session_id}`,
  ).toHaveLength(0);
});
