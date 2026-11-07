import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  historyClear,
  historyLeave,
  historyRead,
  historySession,
  historyShift,
  leaveFixture,
  leaveIds,
  type LeaveFixture,
} from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
beforeEach(async () => {
  await f.h
    .owner`UPDATE attendance_sessions SET voided_at=NULL,voided_by=NULL,void_request_id=NULL WHERE company_id=${f.company}`;
  await f.h.owner`DELETE FROM attendance_change_requests WHERE company_id=${f.company}`;
  await historyClear(f);
  await f.h.owner`DELETE FROM employee_default_shifts WHERE company_id=${f.company}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const date = '2026-10-01';
const noAbsence = async () =>
  expect((await historyRead(f)).items.filter((r) => r.row_type === 'UNEXCUSED_ABSENCE')).toEqual(
    [],
  );
async function contractDay() {
  await f.h
    .owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",updated_by,updated_at)
    VALUES(${f.company},${f.business},${f.employee.id},${f.branch},5,'09:00','17:00',${f.userId},now())`;
}
// نفس الحالات المثبتة في characterization الخاصة بـ68-1a؛ النتيجة المقابلة هناك هي no_attendance=true.
it('TD-1 D-a: another branch session excuses history although the branch statement does not count it', async () => {
  await historyShift(f, date);
  await historySession(f, date, { branch: f.secondBranch, status: 'CLOSED' });
  await noAbsence();
});
it('TD-1 D-b: pending leave suppresses history absence, while the statement ignores the leave', async () => {
  await contractDay();
  await historyShift(f, date);
  await historyLeave(f, date, { status: 'PENDING' });
  await noAbsence();
});
it.each([
  { name: 'D-c1 contract day', contract: true, other: false, partial: false },
  { name: 'D-c2 schedule only', contract: false, other: false, partial: false },
  { name: 'D-c3 other branch', contract: true, other: true, partial: false },
  { name: 'D-c4 partial', contract: true, other: false, partial: true },
])(
  'TD-1 $name: approved leave suppresses history absence beside the statement note',
  async (scenario) => {
    if (scenario.contract) await contractDay();
    await historyShift(f, date);
    const id = await historyLeave(f, date, {
      branch: scenario.other ? f.secondBranch : f.branch,
      kind: scenario.partial ? 'PARTIAL' : 'FULL_DAY',
    });
    const page = await historyRead(f);
    expect(page.items.map((r) => r.id)).toEqual([id]);
    expect(page.items[0]).toMatchObject({ row_type: 'LEAVE', type: 'ANNUAL' });
  },
);
it('TD-1 D-d: uncorrected MISSED_OUT still excuses history absence', async () => {
  await historyShift(f, date);
  await historySession(f, date, { status: 'MISSED_OUT' });
  await noAbsence();
});
it.each([
  { name: 'D-e1 before hire', hire: '2026-10-02', end: null },
  { name: 'D-e2 after end', hire: '2026-01-01', end: '2026-09-30' },
])(
  'TD-1 $name: history excludes out-of-contract days retained by the statement',
  async ({ hire, end }) => {
    await historyShift(f, date);
    await f.h
      .owner`UPDATE employees SET hire_date=${hire},contract_end=${end} WHERE company_id=${f.company} AND id=${f.employee.id}`;
    try {
      await noAbsence();
    } finally {
      await f.h
        .owner`UPDATE employees SET hire_date='2026-01-01',contract_end=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
    }
  },
);
it('TD-1 control: overnight shift remains on the start day', async () => {
  await historyShift(f, date, { start: '22:00', end: '02:00', endsAt: '2026-10-02T02:00:00Z' });
  expect((await historyRead(f)).items).toMatchObject([
    { row_type: 'UNEXCUSED_ABSENCE', working_date: date },
  ]);
});
it('TD-1 control: one attended shift excuses both ranges of a split day', async () => {
  await historyShift(f, date, { start: '09:00', end: '12:00' });
  await historyShift(f, date, { start: '16:00', end: '20:00' });
  await historySession(f, date, { status: 'CLOSED' });
  await noAbsence();
});
it.each([false, true])('TD-1 control: voided-only=%s, OPEN otherwise', async (voided) => {
  await historyShift(f, date);
  const session = await historySession(f, date, { status: voided ? 'CLOSED' : 'OPEN' });
  if (voided) {
    const request = leaveIds.newId();
    await f.h
      .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,status,
      session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at)
      VALUES(${f.company},${request},${f.business},${f.branch},${f.employee.id},'VOID_SESSION','APPROVED',${session},0,
      'Synthetic void',${f.userId},now(),${f.userId},now())`;
    await f.h
      .owner`UPDATE attendance_sessions SET voided_at=now(),voided_by=${f.userId},void_request_id=${request}
      WHERE company_id=${f.company} AND id=${session}`;
  }
  expect((await historyRead(f)).items.map((r) => r.row_type)).toEqual(
    voided ? ['UNEXCUSED_ABSENCE'] : [],
  );
});
it.each([false, true])(
  'TD-1 control: unended day creates no absence, counted earlier day=%s',
  async (earlier) => {
    if (earlier) await historySession(f, '2026-09-30', { status: 'CLOSED' });
    await historyShift(f, date);
    expect((await historyRead(f, {}, '2026-10-01T09:00:00.000Z')).items).toEqual([]);
  },
);
