import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequest, attendanceChangeDecisionResult } from '@pospay/contracts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  changeEvents,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { correctionRows, sessionRow } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { createAddSessionKind } from '../persistence/add-session-kind.ts';
import { createAttendanceChangeKinds } from '../persistence/attendance-change-kinds.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';

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
const route = () => `/v1/businesses/${f.business}/attendance-change-requests`;
const headers = (cookie = f.approverCookie) => ({
  cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});

async function assertManualSession(requestId: string, sessionId: string | null) {
  const sessions = await f.h
    .owner`SELECT * FROM attendance_sessions WHERE change_request_id=${requestId}`;
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    id: sessionId,
    source: 'MANUAL',
    status: 'CLOSED',
    closed_by: 'MANUAL',
    geo: 'NONE',
    out_geo: 'NONE',
    revision: 0,
    late_minutes: 0,
  });
  for (const key of [
    'binding_id',
    'binding_revision',
    'out_binding_id',
    'out_binding_revision',
    'device_id',
    'out_device_id',
    'operator_id',
    'out_operator_id',
    'qr_window',
    'out_qr_window',
    'latitude',
    'longitude',
    'accuracy',
    'out_latitude',
    'out_longitude',
    'out_accuracy',
  ])
    expect(sessions[0]?.[key]).toBeNull();
}

it('AMS-01/02/09 files PENDING, then atomically creates one linked manual day without scan facts', async () => {
  const response = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: changeInput(f),
  });
  expect(response.statusCode).toBe(201);
  const row = attendanceChangeRequest.parse(response.json());
  expect(row).toMatchObject({
    status: 'PENDING',
    session_id: null,
    requested: {
      clock_in: changeInput(f).clock_in,
      working_date: '2026-10-03',
      timezone: 'Asia/Kuwait',
    },
  });
  expect(
    await f.h.owner`SELECT id FROM attendance_sessions WHERE change_request_id=${row.id}`,
  ).toHaveLength(0);
  const command = {
    method: 'POST' as const,
    url: `${route()}/${row.id}/decide`,
    headers: headers(ownerCookie),
    payload: { decision: 'APPROVED', revision: 0 },
  };
  const approved = await f.h.app.inject(command);
  expect(approved.statusCode).toBe(200);
  const result = attendanceChangeDecisionResult.parse(approved.json());
  expect(result).toMatchObject({ status: 'APPROVED', effect: null, requested: row.requested });
  expect((await f.h.app.inject(command)).json()).toEqual(result);
  await assertManualSession(row.id, result.session_id);
  expect((await changeAudits(f, row.id)).map((r) => r['action'])).toEqual([
    'attendance_change.requested',
    'attendance_change.approved',
  ]);
  const [audit] = await f.h
    .owner`SELECT after FROM audit_log WHERE entity_id=${result.session_id} AND action='attendance_session.added_manual'`;
  expect(audit?.['after']).toMatchObject({
    change_request_id: row.id,
    requested_by: f.approverId,
    approved_by: f.owner,
    source: 'MANUAL',
  });
  expect((await changeEvents(f, row.id)).map((r) => r['event_type'])).toEqual([
    'AttendanceChangeRequested',
    'AttendanceChangeDecided',
  ]);
  expect(
    await f.h.owner`SELECT id FROM outbox WHERE aggregate_id=${result.session_id}`,
  ).toHaveLength(0);
});

it('AMS-03 owner one-step commits the deferred FK and idempotently returns the created session', async () => {
  const payload = {
    ...changeInput(f),
    clock_in: '2026-10-02T07:00:00.000Z',
    clock_out: '2026-10-02T16:00:00.000Z',
  };
  const command = { method: 'POST' as const, url: route(), headers: headers(ownerCookie), payload };
  const response = await f.h.app.inject(command);
  expect(response.statusCode).toBe(201);
  const row = attendanceChangeRequest.parse(response.json());
  expect(row).toMatchObject({ status: 'APPROVED', requested_by: f.owner, decided_by: f.owner });
  expect(row.session_id).not.toBeNull();
  expect((await f.h.app.inject(command)).json()).toEqual(row);
  expect(
    await f.h.owner`SELECT s.id,s.source,s.status,s.branch_id,s.employee_id,r.status AS request_status,r.revision
      FROM attendance_sessions s JOIN attendance_change_requests r
        ON r.company_id=s.company_id AND r.id=s.change_request_id
      WHERE s.change_request_id=${row.id}`,
  ).toEqual([
    {
      id: row.session_id,
      source: 'MANUAL',
      status: 'CLOSED',
      branch_id: f.branch,
      employee_id: f.employee.id,
      request_status: 'APPROVED',
      revision: 1,
    },
  ]);
  const actions = await f.h.owner`SELECT action FROM audit_log
    WHERE (entity='attendance_change_request' AND entity_id=${row.id})
      OR (entity='attendance_session' AND entity_id=${row.session_id}) ORDER BY id`;
  expect(actions.map((a) => a.action)).toEqual([
    'attendance_change.requested',
    'attendance_session.added_manual',
    'attendance_change.approved',
  ]);
});

it('AMS-07 refuses ordinary correction without changing the manual day or adding history', async () => {
  const row = await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...changeInput(f),
    clock_in: '2026-10-01T07:00:00Z',
    clock_out: '2026-10-01T16:00:00Z',
  });
  if (!row.session_id) throw new Error('MANUAL_SESSION_MISSING');
  const before = await sessionRow(f, row.session_id);
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/attendance-sessions/${row.session_id}/correct`,
    headers: headers(ownerCookie),
    payload: { revision: 0, clock_out: '2026-10-01T17:00:00Z', reason: 'extend manual day' },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({
    code: 'ATTENDANCE_CORRECTION_MANUAL_SESSION',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
  expect(await sessionRow(f, row.session_id)).toEqual(before);
  expect(await correctionRows(f, row.session_id)).toHaveLength(0);
});

it('rolls back the real session, audit and idempotency result when approval fails after apply', async () => {
  const row = await f.fileChange.execute(changeActor(f), {
    ...changeInput(f),
    clock_in: '2026-09-30T07:00:00Z',
    clock_out: '2026-09-30T16:00:00Z',
  });
  const kind = createAddSessionKind(leaveIds);
  let insertedId: string | null = null;
  const failing = new DecideAttendanceChangeUseCase(
    f.tx,
    f.clock,
    createAttendanceChangeKinds([
      {
        ...kind,
        apply: async (scope, values) => {
          insertedId = (await kind.apply(scope, values)).session_id;
          throw new AttendanceChangeError('VALIDATION_FAILED');
        },
      },
    ]),
  );
  const actor = changeActor(f, row.id, f.owner);
  await expect(failing.execute(actor, { decision: 'APPROVED', revision: 0 })).rejects.toMatchObject(
    { code: 'VALIDATION_FAILED' },
  );
  expect(insertedId).not.toBeNull();
  expect(
    await f.h.owner`SELECT id FROM attendance_sessions WHERE change_request_id=${row.id}`,
  ).toHaveLength(0);
  expect(await f.h.owner`SELECT id FROM audit_log WHERE entity_id=${insertedId}`).toHaveLength(0);
  expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${actor.key}`).toHaveLength(0);
  expect(await changeAudits(f, row.id)).toHaveLength(1);
  expect(await changeEvents(f, row.id)).toHaveLength(1);
  expect(await f.h.owner`SELECT status FROM attendance_change_requests WHERE id=${row.id}`).toEqual(
    [{ status: 'PENDING' }],
  );
});
