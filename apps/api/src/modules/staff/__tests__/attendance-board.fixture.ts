import { vi } from 'vitest';
import type * as StaffModule from '../staff.module.ts';
import { ATTENDANCE_BOARD_CLOCK } from '../http/attendance-board.controller.ts';
import { attendanceCorrectionFixture } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

const clock = vi.hoisted(() => ({ now: () => new Date('2026-10-04T22:30:00Z') }));
vi.mock('../staff.module.ts', async (original) => {
  const real = await original<typeof StaffModule>();
  return {
    ...real,
    staffProviders: (...args: Parameters<typeof real.staffProviders>) =>
      real
        .staffProviders(...args)
        .map((provider) =>
          typeof provider === 'object' &&
          'provide' in provider &&
          provider.provide === ATTENDANCE_BOARD_CLOCK
            ? { provide: ATTENDANCE_BOARD_CLOCK, useValue: clock }
            : provider,
        ),
  };
});
export async function attendanceBoardFixture() {
  const f = await attendanceCorrectionFixture();
  return {
    ...f,
    boardClock: clock,
    scope: {
      companyId: f.company,
      businessId: f.business,
      branchId: f.branch,
      timezone: 'Asia/Kuwait',
    },
  };
}
export type BoardFixture = Awaited<ReturnType<typeof attendanceBoardFixture>>;

export async function seedManual(f: BoardFixture, sessionId = leaveIds.newId()) {
  const requestId = leaveIds.newId();
  await f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,
    kind,clock_in,clock_out,working_date,timezone,reason,requested_by,requested_at)
    VALUES(${f.company},${requestId},${f.business},${f.branch},${f.employee.id},'ADD_SESSION',
      '2026-10-04T05:00:00Z','2026-10-04T08:00:00Z','2026-10-04','Asia/Kuwait','synthetic',${f.userId},'2026-10-04T09:00:00Z')`;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,
    timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes,change_request_id)
    VALUES(${f.company},${sessionId},${f.business},${f.branch},${f.employee.id},'2026-10-04','Asia/Kuwait',
      '2026-10-04T05:00:00Z','2026-10-04T08:00:00Z','CLOSED','MANUAL','MANUAL','NONE',0,${requestId})`;
  await f.h.owner`UPDATE attendance_change_requests SET status='APPROVED',session_id=${sessionId},
    decided_by=${f.approverId},decided_at='2026-10-04T10:00:00Z' WHERE company_id=${f.company} AND id=${requestId}`;
  return { sessionId, requestId };
}
export async function seedVoided(f: BoardFixture, sessionId: string) {
  const requestId = leaveIds.newId();
  const [session] = await f.h
    .owner`SELECT employee_id FROM attendance_sessions WHERE company_id=${f.company} AND id=${sessionId}`;
  await f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,
    kind,status,session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${requestId},${f.business},${f.branch},${session?.employee_id as string},'VOID_SESSION','APPROVED',
      ${sessionId},0,'synthetic',${f.userId},'2026-10-04T10:00:00Z',${f.approverId},'2026-10-04T11:00:00Z')`;
  await f.h
    .owner`UPDATE attendance_sessions SET voided_at='2026-10-04T11:00:00Z',voided_by=${f.approverId},
    void_request_id=${requestId} WHERE company_id=${f.company} AND id=${sessionId}`;
}
