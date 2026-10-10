import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  scheduleCandidates,
  scheduleCandidatesStatement,
} from '../persistence/attendance-context.adapter.ts';
import {
  attendanceFixture,
  seedAttendanceBreak,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';

let f: AttendanceFixture;
let sessionId: string;
const at = new Date('2026-10-03T14:05:00+03:00');

beforeAll(async () => {
  f = await attendanceFixture();
  await seedAttendanceBreak(f, '2026-10-03');
  sessionId = f.ids.newId();
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    VALUES(${f.companyId},${sessionId},${f.businessId},${f.branchId},${f.employeeId},'2026-10-03','Asia/Kuwait',
      '2026-10-03T08:58:00+03:00','2026-10-03T13:00:00+03:00','CLOSED','BARCODE','EMPLOYEE','NONE',0)`;
  const other = f.ids.newId();
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${other},${f.businessId},${f.branchId},'Synthetic history employee','synthetic history employee','staff','2020-01-01')`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.branchId},${other},'2026-10-03','Asia/Kuwait',
      '2026-10-03T08:58:00+03:00','2026-10-03T13:00:00+03:00','CLOSED','BARCODE','EMPLOYEE','NONE',0)`;
});
afterAll(async () => {
  await f?.close();
});

it.each([
  ['08:59:00', false],
  ['09:00:00', false],
  ['09:00:00.001', true],
  ['13:00:00', true],
  ['14:05:00', true],
  ['14:05:00.001', false],
] as const)(
  'closed session at %s gives returning=%s for this employee',
  async (time, returning) => {
    await f.owner`UPDATE attendance_sessions SET clock_out=${'2026-10-03T' + time + '+03:00'} WHERE id=${sessionId}`;
    const rows = await f.database.withTenant(f.companyId, (tx) =>
      scheduleCandidates(tx, f.scope, f.branchId, at, 'Asia/Kuwait'),
    );
    expect(rows).toMatchObject([{ returning }]);
    const row = rows[0];
    if (row?.break_starts_at == null || row.break_ends_at === null)
      throw new Error('BREAK_MISSING');
    expect(new Date(row.break_starts_at)).toEqual(new Date('2026-10-03T13:00:00+03:00'));
    expect(new Date(row.break_ends_at)).toEqual(new Date('2026-10-03T14:00:00+03:00'));
  },
);

it('an open morning session is not a return fact and another tenant sees no candidates', async () => {
  await f.owner`UPDATE attendance_sessions SET clock_out=NULL,status='OPEN',closed_by=NULL WHERE id=${sessionId}`;
  expect(
    await f.database.withTenant(f.companyId, (tx) =>
      scheduleCandidates(tx, f.scope, f.branchId, at, 'Asia/Kuwait'),
    ),
  ).toMatchObject([{ returning: false }]);
  expect(
    await f.database.withTenant(f.otherCompany, (tx) =>
      scheduleCandidates(tx, f.scope, f.branchId, at, 'Asia/Kuwait'),
    ),
  ).toHaveLength(0);
  await f.owner`UPDATE attendance_sessions SET clock_out='2026-10-03T13:00:00+03:00',status='CLOSED',closed_by='EMPLOYEE' WHERE id=${sessionId}`;
});

it('a closed session from an earlier shift on the same date does not make the later shift a return', async () => {
  await seedAttendanceBreak(f, '2026-10-10');
  await f.owner`UPDATE staff_schedule_shifts SET start='14:00',"end"='22:00',starts_at='2026-10-10T14:00:00+03:00',
    ends_at='2026-10-10T22:00:00+03:00',break_start='18:00',break_end='19:00',
    break_starts_at='2026-10-10T18:00:00+03:00',break_ends_at='2026-10-10T19:00:00+03:00' WHERE working_date='2026-10-10'`;
  await f.owner`UPDATE attendance_sessions SET clock_in='2026-10-10T08:58:00+03:00',clock_out='2026-10-10T13:00:00+03:00',
    working_date='2026-10-10' WHERE id=${sessionId}`;
  const rows = await f.database.withTenant(f.companyId, (tx) =>
    scheduleCandidates(
      tx,
      f.scope,
      f.branchId,
      new Date('2026-10-10T19:05:00+03:00'),
      'Asia/Kuwait',
    ),
  );
  expect(rows).toMatchObject([{ returning: false }]);
});

it('only an employee-closed session is a return fact, and the EXISTS stays on the employee/date index', async () => {
  await f.owner`UPDATE attendance_sessions SET clock_in='2026-10-03T08:58:00+03:00',clock_out='2026-10-03T13:00:00+03:00',
    working_date='2026-10-03',status='MISSED_OUT',closed_by='MISSED_OUT' WHERE id=${sessionId}`;
  await f.owner`ANALYZE attendance_sessions`;
  await f.database.withTenant(f.companyId, async (tx) => {
    expect(await scheduleCandidates(tx, f.scope, f.branchId, at, 'Asia/Kuwait')).toMatchObject([
      { returning: false },
    ]);
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${scheduleCandidatesStatement(f.scope, f.branchId, at, 'Asia/Kuwait')}`,
    );
    expect(JSON.stringify(plan)).toContain('attendance_sessions_employee_date_idx');
  });
  await f.owner`UPDATE attendance_sessions SET status='CLOSED',closed_by='EMPLOYEE' WHERE id=${sessionId}`;
});
