import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const terms = (day: string) => ({
  ...changeInput(f),
  clock_in: `${day}T07:00:00.000Z`,
  clock_out: `${day}T16:00:00.000Z`,
});

it('one ADD_SESSION request can never own two manual sessions', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-14'));
  const approved = await f.decideChange.execute(changeActor(f, row.id, f.owner), {
    decision: 'APPROVED',
    revision: 0,
  });
  expect(approved.session_id).not.toBeNull();
  await expect(
    f.h
      .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes,change_request_id)
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},'2026-09-13','Asia/Kuwait','2026-09-13T07:00:00Z','2026-09-13T08:00:00Z','CLOSED','MANUAL','MANUAL','NONE',0,${row.id})`,
  ).rejects.toMatchObject({
    code: '23505',
    constraint_name: 'attendance_sessions_change_request_idx',
  });
  expect(
    await f.h.owner`SELECT id FROM attendance_sessions WHERE change_request_id=${row.id}`,
  ).toEqual([{ id: approved.session_id }]);
});

it('an APPROVED ADD_SESSION request must point at its session', async () => {
  const row = await f.fileChange.execute(changeActor(f), terms('2026-09-12'));
  await expect(
    f.h.owner`UPDATE attendance_change_requests SET status='APPROVED',revision=1,
      decided_by=${f.owner},decided_at=now() WHERE id=${row.id}`,
  ).rejects.toMatchObject({
    code: '23514',
    constraint_name: 'attendance_change_requests_add_linked',
  });
  expect(
    await f.h.owner`SELECT status,session_id FROM attendance_change_requests WHERE id=${row.id}`,
  ).toEqual([{ status: 'PENDING', session_id: null }]);
});
