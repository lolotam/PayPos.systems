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
      clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_start,scheduled_end)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},'2026-10-30','Asia/Kuwait',
      '2026-10-30T18:00:00+03:00','2026-10-31T10:00:00+03:00','MISSED_OUT','QR','MISSED_OUT','OK',0,
      '2026-10-31T09:00:00+03:00','2026-10-31T17:00:00+03:00')`;
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

it('BW-07 QR arrival for a back-to-back shift B is late from B, not from B break end', async () => {
  const date = '2026-11-14';
  const schedule = f.ids.newId();
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.companyId},${schedule},${f.businessId},${f.branchId},${f.employeeId},${date},'Asia/Kuwait',1)`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at,
      break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.companyId},${f.ids.newId()},${schedule},${f.employeeId},${date},0,'04:00','19:00',
      ${date + 'T04:00:00+03:00'},${date + 'T19:00:00+03:00'},NULL,NULL,NULL,NULL),
      (${f.companyId},${f.ids.newId()},${schedule},${f.employeeId},${date},0,'19:00','23:00',
      ${date + 'T19:00:00+03:00'},${date + 'T23:00:00+03:00'},'22:00','22:30',
      ${date + 'T22:00:00+03:00'},${date + 'T22:30:00+03:00'})`;
  expect(await clock(date, '04:00')).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 0 });
  expect(await clock(date, '19:05')).toMatchObject({ operation: 'CLOCK_OUT' });
  const arrival = await clock(date, '22:10');
  expect(arrival).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 190 });
  expect(
    await f.owner`SELECT scheduled_start FROM attendance_sessions WHERE id=${arrival.session_id}`,
  ).toMatchObject([{ scheduled_start: new Date(`${date}T19:00:00+03:00`) }]);
  await clock(date, '23:00');
});

it('BW-07 QR closed session at another branch is not a return', async () => {
  const date = '2026-11-21';
  await seedAttendanceBreak(f, date);
  const branch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.companyId},${branch},${f.businessId},'Synthetic second branch')`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_start,scheduled_end)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${branch},${f.employeeId},${date},'Asia/Kuwait',
      ${date + 'T08:58:00+03:00'},${date + 'T13:00:00+03:00'},'CLOSED','BARCODE','EMPLOYEE','NONE',0,
      ${date + 'T09:00:00+03:00'},${date + 'T17:00:00+03:00'})`;
  const arrival = await clock(date, '14:05');
  expect(arrival).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 305 });
  await clock(date, '17:00');
});

it('BW-Q11 QR out at 12:55 (10 minutes before the break or less) and back at 14:05 is a return, not late', async () => {
  const date = '2026-11-28';
  await seedAttendanceBreak(f, date);
  expect(await clock(date, '08:58')).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 0 });
  expect(await clock(date, '12:55')).toMatchObject({ operation: 'CLOCK_OUT', late_minutes: 0 });
  const returned = await clock(date, '14:05');
  expect(returned).toMatchObject({ operation: 'CLOCK_IN', late_minutes: 0, exceptions: [] });
  expect(
    await f.owner`SELECT scheduled_start FROM attendance_sessions WHERE id=${returned.session_id}`,
  ).toMatchObject([{ scheduled_start: new Date(`${date}T14:00:00+03:00`) }]);
  await clock(date, '17:00');
});
