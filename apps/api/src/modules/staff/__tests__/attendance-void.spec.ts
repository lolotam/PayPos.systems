import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeDecisionResult } from '@pospay/contracts';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidRow,
  voidAudits,
  changeAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { correctionActor, correctionInput, seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const approve = (id: string) =>
  f.decideChange.execute(changeActor(f, id, f.owner), { decision: 'APPROVED', revision: 0 });
const pending = async (id: string) => {
  const [row] = await f.h
    .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${id}`;
  expect(row?.status).toBe('PENDING');
};

it.each(['CLOSED', 'MISSED_OUT'] as const)(
  'AVS-01/02 %s stays unchanged until approval, then only void marks and revision change',
  async (status) => {
    const input = await voidInput(f, {
      status,
      closedBy: status === 'MISSED_OUT' ? 'MISSED_OUT' : 'EMPLOYEE',
      source: 'BARCODE',
      outOperatorId: f.approverId,
    });
    const before = await voidRow(f, input.session_id);
    const row = await f.fileChange.execute(changeActor(f), input);
    expect(row.status).toBe('PENDING');
    expect(await voidRow(f, input.session_id)).toEqual(before);
    const actor = changeActor(f, row.id, f.owner);
    const result = attendanceChangeDecisionResult.parse(
      await f.decideChange.execute(actor, { decision: 'APPROVED', revision: 0 }),
    );
    expect(result).toMatchObject({
      status: 'APPROVED',
      effect: {
        session: {
          id: input.session_id,
          status,
          revision: 1,
          voided_by: f.owner,
          void_request_id: row.id,
          voided_at: f.clock.now().toISOString(),
        },
      },
    });
    const after = await voidRow(f, input.session_id);
    expect(after).toEqual({
      ...before,
      revision: 1,
      voided_at: after.voided_at,
      voided_by: f.owner,
      void_request_id: row.id,
    });
    expect(await voidAudits(f, input.session_id)).toEqual([
      expect.objectContaining({
        action: 'attendance_session.voided',
        before: { revision: 0, voided_at: null, voided_by: null, void_request_id: null },
        after: {
          revision: 1,
          voided_at: f.clock.now().toISOString(),
          voided_by: f.owner,
          void_request_id: row.id,
        },
      }),
    ]);
    expect(await f.decideChange.execute(actor, { decision: 'APPROVED', revision: 0 })).toEqual(
      result,
    );
    expect(await voidAudits(f, input.session_id)).toHaveLength(1);
  },
);

it('AVS-03 owner one-step commits its request FK and both lifecycle audits for an old day', async () => {
  const input = await voidInput(f, {
    workingDate: '2020-01-01',
    clockIn: '2020-01-01T05:00:00Z',
    clockOut: '2020-01-01T08:00:00Z',
  });
  const actor = changeActor(f, undefined, f.owner);
  const row = await f.fileChange.execute(actor, input);
  expect(row.status).toBe('APPROVED');
  expect(await voidRow(f, input.session_id)).toMatchObject({
    void_request_id: row.id,
    voided_by: f.owner,
    revision: 1,
  });
  expect((await changeAudits(f, row.id)).map((r) => r.action)).toEqual([
    'attendance_change.requested',
    'attendance_change.approved',
  ]);
  expect(await f.fileChange.execute(actor, input)).toEqual(row);
  expect(await voidAudits(f, input.session_id)).toHaveLength(1);
});

it('AVS-04 OPEN filing returns 409 with bilingual error text', async () => {
  const input = await voidInput(f, { status: 'OPEN', clockOut: null, closedBy: null });
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-change-requests`,
    headers: {
      cookie: f.approverCookie,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: input,
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    code: 'ATTENDANCE_SESSION_OPEN',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});

it('AVS-05 rechecks a voided session on filing and approval, leaving the request PENDING', async () => {
  const input = await voidInput(f);
  const original = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  await expect(
    f.fileChange.execute(changeActor(f), { ...input, session_revision: 1 }),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_SESSION_VOIDED' });
  await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...input,
    kind: 'RESTORE_SESSION',
    session_revision: 1,
  });
  const row = await f.fileChange.execute(changeActor(f), { ...input, session_revision: 2 });
  await f.h
    .owner`UPDATE attendance_sessions SET voided_at='2026-10-04T10:00:00Z',voided_by=${f.owner},void_request_id=${original.id},revision=3 WHERE company_id=${f.company} AND id=${input.session_id}`;
  await expect(approve(row.id)).rejects.toMatchObject({ code: 'ATTENDANCE_SESSION_VOIDED' });
  await pending(row.id);
});

it('AVS-06 correction after filing makes approval stale without changing the request', async () => {
  const input = await voidInput(f);
  const row = await f.fileChange.execute(changeActor(f), input);
  await f.correct.execute(correctionActor(f, input.session_id), correctionInput());
  await expect(approve(row.id)).rejects.toMatchObject({
    code: 'ATTENDANCE_SESSION_REVISION_CONFLICT',
  });
  await pending(row.id);
  expect(await voidAudits(f, input.session_id)).toHaveLength(0);
});

it('AVS-07 refuses duplicate PENDING requests including owner one-step bypass', async () => {
  const input = await voidInput(f);
  await f.fileChange.execute(changeActor(f), input);
  for (const actor of [f.approverId, f.owner])
    await expect(
      f.fileChange.execute(changeActor(f, undefined, actor), input),
    ).rejects.toMatchObject({ code: 'ATTENDANCE_CHANGE_DUPLICATE_PENDING' });
});

it('AVS-08 refuses correction of a voided target over HTTP and ignores a voided neighbour', async () => {
  const input = await voidInput(f, {
    clockIn: '2026-10-04T07:00:00Z',
    clockOut: '2026-10-04T16:00:00Z',
  });
  await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-sessions/${input.session_id}/correct`,
    headers: {
      cookie: f.approverCookie,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: correctionInput(1),
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('ATTENDANCE_SESSION_VOIDED');
  const other = await seedSession(f, {
    employeeId: input.employee_id,
    clockIn: '2026-10-04T06:00:00Z',
    clockOut: '2026-10-04T07:00:00Z',
  });
  const now = f.clock.now;
  f.clock.now = () => new Date('2026-10-04T20:00:00Z');
  try {
    const result = await f.correct.execute(
      correctionActor(f, other),
      correctionInput(0, { clock_in: '2026-10-04T09:00:00Z', clock_out: '2026-10-04T12:00:00Z' }),
    );
    expect(result.session.clock_out).toBe('2026-10-04T12:00:00.000Z');
  } finally {
    f.clock.now = now;
  }
});

it('AVS-09 keeps corrections and OPEN exceptions byte-identical', async () => {
  const input = await voidInput(f);
  await f.correct.execute(correctionActor(f, input.session_id), correctionInput());
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at) VALUES(${f.company},${leaveIds.newId()},${f.business},${input.employee_id},${f.branch},${input.session_id},'OUT_OF_RANGE','2026-10-04T05:00:00Z')`;
  const history = () =>
    f.h
      .owner`SELECT 'correction' AS kind,to_jsonb(c)::text AS record FROM attendance_corrections c WHERE company_id=${f.company} AND session_id=${input.session_id} UNION ALL SELECT 'exception',to_jsonb(e)::text FROM attendance_exceptions e WHERE company_id=${f.company} AND session_id=${input.session_id} ORDER BY kind,record`;
  const before = await history();
  await f.fileChange.execute(changeActor(f, undefined, f.owner), { ...input, session_revision: 1 });
  expect(await history()).toEqual(before);
  expect(before).toHaveLength(2);
});
