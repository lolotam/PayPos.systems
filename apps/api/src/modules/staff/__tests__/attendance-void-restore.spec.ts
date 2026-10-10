import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeDecisionResult, attendanceChangeRequest } from '@pospay/contracts';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidRow,
  voidAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
let ownerCookie: string;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
  const signed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: 'http://admin.test' },
    payload: { email: 'employee-owner@example.test', password: 'operator-chosen-pass' },
  });
  const cookies = signed.headers['set-cookie'];
  ownerCookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((s) => s.split(';')[0])
    .join('; ');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const headers = (cookie = f.approverCookie) => ({
  cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});
const route = () => `/v1/businesses/${f.business}/attendance-change-requests`;
const restoreInput = async () => {
  const input = await voidInput(f);
  const original = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  return { input: { ...input, kind: 'RESTORE_SESSION' as const, session_revision: 1 }, original };
};
async function expectRestoreAudit(sessionId: string, originalId: string) {
  const audits = await voidAudits(f, sessionId);
  expect(audits).toHaveLength(2);
  expect(audits[1]).toMatchObject({
    action: 'attendance_session.restored',
    before: { revision: 1, voided_by: f.owner, void_request_id: originalId },
    after: { revision: 2, voided_at: null, voided_by: null, void_request_id: null },
  });
}

it('AVS-11 files and approves restore through the production HTTP registry, preserving the original void request', async () => {
  const { input, original } = await restoreInput();
  const originalRow = () =>
    f.h
      .owner`SELECT to_jsonb(r)::text AS record FROM attendance_change_requests r WHERE company_id=${f.company} AND id=${original.id}`;
  const history = await originalRow();
  const before = await voidRow(f, input.session_id);
  const filed = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: input,
  });
  expect(filed.statusCode).toBe(201);
  const row = attendanceChangeRequest.parse(filed.json());
  expect(row).toMatchObject({
    status: 'PENDING',
    requested: {
      timezone: 'Asia/Kuwait',
      working_date: '2026-10-04',
      clock_in: '2026-10-04T05:00:00.000Z',
      clock_out: '2026-10-04T08:00:00.000Z',
    },
  });
  expect(await voidRow(f, input.session_id)).toEqual(before);
  const request = {
    method: 'POST' as const,
    url: `${route()}/${row.id}/decide`,
    headers: headers(ownerCookie),
    payload: { decision: 'APPROVED', revision: 0 },
  };
  const approved = await f.h.app.inject(request);
  expect(approved.statusCode).toBe(200);
  const result = attendanceChangeDecisionResult.parse(approved.json());
  expect(result).toMatchObject({
    status: 'APPROVED',
    effect: {
      session: {
        id: input.session_id,
        voided_at: null,
        voided_by: null,
        void_request_id: null,
        revision: 2,
      },
    },
  });
  expect(await voidRow(f, input.session_id)).toEqual({
    ...before,
    voided_at: null,
    voided_by: null,
    void_request_id: null,
    revision: 2,
  });
  expect(await originalRow()).toEqual(history);
  expect((await f.h.app.inject(request)).json()).toEqual(result);
  await expectRestoreAudit(input.session_id, original.id);
});

it('AVS-12 non-voided restore returns 409', async () => {
  const input = await voidInput(f);
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: { ...input, kind: 'RESTORE_SESSION' },
  });
  expect(result.statusCode).toBe(409);
  expect(result.json().code).toBe('ATTENDANCE_SESSION_NOT_VOIDED');
});

it.each(['CLOSED', 'MISSED_OUT', 'OPEN'] as const)(
  'AVS-13 %s overlap appearing before approval returns 422 and leaves PENDING',
  async (status) => {
    const { input } = await restoreInput();
    const row = await f.fileChange.execute(changeActor(f), input);
    await seedSession(f, {
      employeeId: input.employee_id,
      status,
      clockIn: '2026-10-04T07:00:00Z',
      clockOut: status === 'OPEN' ? null : '2026-10-04T09:00:00Z',
      closedBy: status === 'OPEN' ? null : status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE',
    });
    const result = await f.h.app.inject({
      method: 'POST',
      url: `${route()}/${row.id}/decide`,
      headers: headers(ownerCookie),
      payload: { decision: 'APPROVED', revision: 0 },
    });
    expect(result.statusCode).toBe(422);
    expect(result.json().code).toBe('ATTENDANCE_RESTORE_OVERLAP');
    const [unchanged] = await f.h
      .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${row.id}`;
    expect(unchanged?.status).toBe('PENDING');
    expect(await voidRow(f, input.session_id)).toMatchObject({ revision: 1 });
    expect(await voidAudits(f, input.session_id)).toHaveLength(1);
  },
);

it('refuses overlap already present at filing, but permits touching ends and voided neighbours', async () => {
  const { input } = await restoreInput();
  const overlap = await voidInput(f, {
    employeeId: input.employee_id,
    clockIn: '2026-10-04T07:00:00Z',
    clockOut: '2026-10-04T09:00:00Z',
  });
  await expect(f.fileChange.execute(changeActor(f), input)).rejects.toMatchObject({
    code: 'ATTENDANCE_RESTORE_OVERLAP',
  });
  await f.fileChange.execute(changeActor(f, undefined, f.owner), overlap);
  await seedSession(f, {
    employeeId: input.employee_id,
    clockIn: '2026-10-04T08:00:00Z',
    clockOut: '2026-10-04T09:00:00Z',
  });
  const row = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  expect(row.status).toBe('APPROVED');
  expect(await voidRow(f, input.session_id)).toMatchObject({ revision: 2, voided_at: null });
});

it('AVS-14 blocks a second restore or void, including owner one-step, while restore waits', async () => {
  const { input } = await restoreInput();
  await f.fileChange.execute(changeActor(f), input);
  for (const kind of ['RESTORE_SESSION', 'VOID_SESSION'] as const) {
    for (const userId of [f.approverId, f.owner]) {
      await expect(
        f.fileChange.execute(changeActor(f, undefined, userId), { ...input, kind }),
      ).rejects.toMatchObject({ code: 'ATTENDANCE_CHANGE_DUPLICATE_PENDING' });
    }
  }
});

it('rechecks restore state and revision after filing', async () => {
  for (const clear of [false, true]) {
    const { input } = await restoreInput();
    const row = await f.fileChange.execute(changeActor(f), input);
    if (clear)
      await f.h
        .owner`UPDATE attendance_sessions SET voided_at=NULL,voided_by=NULL,void_request_id=NULL,revision=2 WHERE company_id=${f.company} AND id=${input.session_id}`;
    else
      await f.h
        .owner`UPDATE attendance_sessions SET revision=2 WHERE company_id=${f.company} AND id=${input.session_id}`;
    await expect(
      f.decideChange.execute(changeActor(f, row.id, f.owner), {
        decision: 'APPROVED',
        revision: 0,
      }),
    ).rejects.toMatchObject({
      code: clear ? 'ATTENDANCE_SESSION_NOT_VOIDED' : 'ATTENDANCE_SESSION_REVISION_CONFLICT',
    });
    const [unchanged] = await f.h
      .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${row.id}`;
    expect(unchanged?.status).toBe('PENDING');
  }
});

it.each(['REJECTED', 'CANCELLED'] as const)(
  'does not change the void marks when restore is %s',
  async (status) => {
    const { input } = await restoreInput();
    const row = await f.fileChange.execute(changeActor(f), input);
    const before = await voidRow(f, input.session_id);
    if (status === 'REJECTED') {
      expect(
        (
          await f.decideChange.execute(changeActor(f, row.id, f.owner), {
            decision: 'REJECTED',
            revision: 0,
            reason: 'keep voided',
          })
        ).effect,
      ).toBeNull();
    } else await f.cancelChange.execute(changeActor(f, row.id), { revision: 0 });
    expect(await voidRow(f, input.session_id)).toEqual(before);
    expect(await voidAudits(f, input.session_id)).toHaveLength(1);
  },
);
