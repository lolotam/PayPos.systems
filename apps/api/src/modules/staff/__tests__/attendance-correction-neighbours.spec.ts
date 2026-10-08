import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  correctionNeighbours,
  correctionNeighboursStatement,
} from '../persistence/attendance-correction-records.ts';
import {
  attendanceCorrectionFixture,
  correctionActor,
  correctionInput,
  linkEmployee,
  seedSession,
  type AttendanceCorrectionFixture,
} from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceCorrectionFixture;
let employeeId: string;
let sessionId: string;
beforeAll(async () => {
  f = await attendanceCorrectionFixture();
  employeeId = await linkEmployee(f, null);
  sessionId = await seedSession(f, { employeeId });
  const rows = Array.from({ length: 2000 }, (_, day) => ({ id: leaveIds.newId(), day }));
  await f.h.owner`INSERT INTO attendance_sessions(
      company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes)
    SELECT ${f.company},r.id,${f.business},${f.branch},${employeeId},
      date '2020-01-01' + r.day,'Asia/Kuwait',
      timestamptz '2020-01-01 05:00:00+00' + r.day * interval '1 day',
      timestamptz '2020-01-01 08:00:00+00' + r.day * interval '1 day',
      'CLOSED','BARCODE','EMPLOYEE','NONE',0
    FROM json_to_recordset(${f.h.owner.json(rows)}::json) AS r(id uuid,day integer)`;
  await f.h.owner`ANALYZE attendance_sessions`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const target = () => ({ id: sessionId, working_date: '2026-10-04' });

it('uses the employee/date range index and the single-open index without row locks', async () => {
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON)
      ${correctionNeighboursStatement(f.company, employeeId, target())}`),
  );
  const text = JSON.stringify(plan);
  expect(text).toContain('attendance_sessions_employee_date_idx');
  expect(text).toContain('attendance_sessions_one_open');
  expect(text).toMatch(/Index Cond[^\n]*working_date/);
  expect(text).not.toContain('Seq Scan');
  expect(text).not.toContain('LockRows');
});

it('bounds closed history while retaining an overdue OPEN session and tenant isolation', async () => {
  const neighbour = await seedSession(f, {
    employeeId,
    workingDate: '2026-10-03',
    clockIn: '2026-10-03T20:00:00Z',
    clockOut: '2026-10-04T06:00:00Z',
  });
  const open = await seedSession(f, {
    employeeId,
    workingDate: '2025-01-01',
    clockIn: '2025-01-01T05:00:00Z',
    clockOut: null,
    status: 'OPEN',
    closedBy: null,
  });
  const rows = await f.db.withTenant(f.company, (tx) =>
    correctionNeighbours(tx, f.company, employeeId, target()),
  );
  expect(rows.map((row) => row.id).sort()).toEqual([neighbour, open].sort());
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      correctionNeighbours(tx, f.company, employeeId, target()),
    ),
  ).toEqual([]);
  await expect(f.correct.execute(correctionActor(f, sessionId), correctionInput())).rejects.toThrow(
    'ATTENDANCE_CORRECTION_INVALID_TIMES',
  );
});

it('refuses overlap with a previous-day overnight session', async () => {
  const employee = await linkEmployee(f, null);
  const session = await seedSession(f, { employeeId: employee });
  await seedSession(f, {
    employeeId: employee,
    branchId: f.secondBranch,
    workingDate: '2026-10-03',
    clockIn: '2026-10-03T20:00:00Z',
    clockOut: '2026-10-04T04:30:00Z',
  });
  await expect(
    f.correct.execute(correctionActor(f, session), {
      revision: 0,
      reason: 'arrived earlier',
      clock_in: '2026-10-04T04:00:00Z',
    }),
  ).rejects.toThrow('ATTENDANCE_CORRECTION_INVALID_TIMES');
});

it('retains overlaps across branches whose working dates differ by two days', async () => {
  const employee = await linkEmployee(f, null);
  const session = await seedSession(f, {
    employeeId: employee,
    workingDate: '2026-10-03',
    clockIn: '2026-10-04T09:00:00Z',
    clockOut: '2026-10-04T09:30:00Z',
  });
  await f.h.owner`UPDATE attendance_sessions SET timezone='Pacific/Honolulu' WHERE id=${session}`;
  const neighbour = await seedSession(f, {
    employeeId: employee,
    branchId: f.secondBranch,
    workingDate: '2026-10-05',
    clockIn: '2026-10-04T10:00:00Z',
    clockOut: '2026-10-04T11:00:00Z',
  });
  await f.h
    .owner`UPDATE attendance_sessions SET timezone='Pacific/Kiritimati' WHERE id=${neighbour}`;
  const originalNow = f.clock.now;
  f.clock.now = () => new Date('2026-10-04T12:00:00Z');
  try {
    await expect(
      f.correct.execute(
        correctionActor(f, session),
        correctionInput(0, { clock_out: '2026-10-04T10:30:00Z' }),
      ),
    ).rejects.toThrow('ATTENDANCE_CORRECTION_INVALID_TIMES');
  } finally {
    f.clock.now = originalNow;
  }
});
