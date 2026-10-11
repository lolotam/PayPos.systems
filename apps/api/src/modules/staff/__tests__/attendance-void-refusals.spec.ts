import { afterAll, beforeAll, expect, it } from 'vitest';
import { AttendanceChangeKindRefusal } from '../ports/attendance-change-kinds.port.ts';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function expectRefusal(work: Promise<unknown>, code: string, status: number) {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(AttendanceChangeKindRefusal);
  expect(error).toMatchObject({ code, status });
}
const approve = (id: string) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision: 0 });
const requestStatus = async (id: string) => {
  const [row] = await f.h
    .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${id}`;
  return row?.status;
};

it('refuses filing a void on an OPEN, missing or already voided session as a kind refusal', async () => {
  const open = await voidInput(f, { status: 'OPEN', clockOut: null, closedBy: null });
  await expectRefusal(f.fileChange.execute(changeActor(f), open), 'ATTENDANCE_SESSION_OPEN', 409);
  const missing = { ...(await voidInput(f)), session_id: leaveIds.newId() };
  await expect(f.fileChange.execute(changeActor(f), missing)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  const voided = await voidInput(f);
  await f.fileChange.execute(changeActor(f, undefined, f.owner), voided);
  await expectRefusal(
    f.fileChange.execute(changeActor(f), { ...voided, session_revision: 1 }),
    'ATTENDANCE_SESSION_VOIDED',
    409,
  );
});

it('refuses a second pending void as a kind refusal', async () => {
  const input = await voidInput(f);
  await f.fileChange.execute(changeActor(f), input);
  await expectRefusal(
    f.fileChange.execute(changeActor(f), input),
    'ATTENDANCE_CHANGE_DUPLICATE_PENDING',
    409,
  );
});

it.each([
  ['already voided', 'ATTENDANCE_SESSION_VOIDED'],
  ['revision moved', 'ATTENDANCE_SESSION_REVISION_CONFLICT'],
] as const)(
  'ACR-Q13 a void refused at approval (%s) keeps the request PENDING',
  async (_case, code) => {
    const input = await voidInput(f);
    const row = await f.fileChange.execute(changeActor(f), input);
    if (code === 'ATTENDANCE_SESSION_VOIDED')
      await f.h
        .owner`UPDATE attendance_sessions SET voided_at=now(),voided_by=${f.owner},void_request_id=${row.id} WHERE company_id=${f.company} AND id=${input.session_id}`;
    else
      await f.h
        .owner`UPDATE attendance_sessions SET revision=revision+1 WHERE company_id=${f.company} AND id=${input.session_id}`;
    await expectRefusal(approve(row.id), code, 409);
    expect(await requestStatus(row.id)).toBe('PENDING');
    expect(await voidAudits(f, input.session_id)).toHaveLength(0);
  },
);

it.each([
  ['overlap', 'ATTENDANCE_RESTORE_OVERLAP', 422],
  ['not voided', 'ATTENDANCE_SESSION_NOT_VOIDED', 409],
] as const)(
  'ACR-Q13 a restore refused at approval (%s) keeps the request PENDING',
  async (_case, code, status) => {
    const voided = await voidInput(f);
    await f.fileChange.execute(changeActor(f, undefined, f.owner), voided);
    const input = { ...voided, kind: 'RESTORE_SESSION' as const, session_revision: 1 };
    const row = await f.fileChange.execute(changeActor(f), input);
    if (code === 'ATTENDANCE_RESTORE_OVERLAP')
      await seedSession(f, {
        employeeId: input.employee_id,
        clockIn: '2026-10-04T06:00:00Z',
        clockOut: '2026-10-04T07:00:00Z',
      });
    else
      await f.h
        .owner`UPDATE attendance_sessions SET voided_at=NULL,voided_by=NULL,void_request_id=NULL WHERE company_id=${f.company} AND id=${input.session_id}`;
    await expectRefusal(approve(row.id), code, status);
    expect(await requestStatus(row.id)).toBe('PENDING');
    expect(await voidAudits(f, input.session_id)).toHaveLength(1);
  },
);
