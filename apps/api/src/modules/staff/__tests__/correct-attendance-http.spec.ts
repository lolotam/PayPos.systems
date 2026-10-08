import { afterAll, beforeAll, expect, it } from 'vitest';
import { correctAttendanceResult } from '@pospay/contracts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import {
  attendanceCorrectionFixture,
  correctionInput,
  seedSession,
  linkEmployee,
  correctionRows,
  ownerUserId,
  type AttendanceCorrectionFixture,
} from './attendance-correction.fixture.ts';

let f: AttendanceCorrectionFixture;
beforeAll(async () => {
  f = await attendanceCorrectionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const route = (id: string, business = f.business) =>
  `/v1/businesses/${business}/attendance-sessions/${id}/correct`;
const headers = (cookie = f.approverCookie) => ({
  cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});

it('returns the contract, requires a key, replays and refuses a changed body', async () => {
  const session = await seedSession(f);
  const request = {
    method: 'POST' as const,
    url: route(session),
    headers: headers(),
    payload: correctionInput(),
  };
  const first = await f.h.app.inject(request);
  expect(first.statusCode).toBe(200);
  expect(correctAttendanceResult.parse(first.json()).session.revision).toBe(1);
  expect((await f.h.app.inject(request)).json()).toEqual(first.json());
  const reused = await f.h.app.inject({
    ...request,
    payload: correctionInput(1, { reason: 'another' }),
  });
  expect(reused.statusCode).toBe(422);
  expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  const missing = await f.h.app.inject({
    ...request,
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
  });
  expect(missing.statusCode).toBe(400);
  expect(missing.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  expect(await correctionRows(f, session)).toHaveLength(1);
  expect(f.h.calls.statements.some((row) => row.sql.includes('leave_requests'))).toBe(false);
});

it('rejects malformed bodies and no-op times with the bilingual validation envelope', async () => {
  const session = await seedSession(f);
  for (const payload of [
    correctionInput(0, { reason: '' }),
    correctionInput(0, { reason: '   ' }),
    correctionInput(0, { reason: 'x'.repeat(501) }),
    correctionInput(-1),
    correctionInput(0.5),
    { revision: 0, reason: 'missing times' },
    correctionInput(0, { clock_out: 'bad-date' }),
    correctionInput(0, { clock_out: '2026-10-04T08:00:00Z' }),
    { ...correctionInput(), branch_id: f.branch },
  ]) {
    const result = await f.h.app.inject({
      method: 'POST',
      url: route(session),
      headers: headers(),
      payload,
    });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  }
  expect(await correctionRows(f, session)).toHaveLength(0);
});

it('CA-05 owner succeeds on self while another manager receives 403', async () => {
  const signedIn = await f.h.app.inject({
    method: 'POST',
    url: '/v1/auth/sign-in/email',
    headers: { origin: 'http://admin.test' },
    payload: { email: 'employee-owner@example.test', password: 'operator-chosen-pass' },
  });
  expect(signedIn.statusCode).toBe(200);
  const cookies = signedIn.headers['set-cookie'];
  const ownerCookie = (Array.isArray(cookies) ? cookies : [cookies ?? ''])
    .map((value) => value.split(';')[0])
    .join('; ');
  const session = await seedSession(f, { employeeId: await linkEmployee(f, await ownerUserId(f)) });
  const allowed = await f.h.app.inject({
    method: 'POST',
    url: route(session),
    headers: headers(ownerCookie),
    payload: correctionInput(),
  });
  expect(allowed.statusCode).toBe(200);
  const own = await seedSession(f, { employeeId: f.employee.id });
  const refused = await f.h.app.inject({
    method: 'POST',
    url: route(own),
    headers: headers(f.cookie),
    payload: correctionInput(),
  });
  expect(refused.statusCode).toBe(403);
  expect(refused.json()).toMatchObject({
    code: 'ATTENDANCE_CORRECTION_SELF_FORBIDDEN',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});

it('CA-06 hides out-of-scope resources behind the same 404', async () => {
  await asRole(f, 'branch_manager');
  const session = await seedSession(f, { branchId: f.secondBranch });
  const requests = [
    { url: route(session), headers: headers() },
    { url: route(leaveIds.newId()), headers: headers() },
    { url: route(session, f.secondBusiness), headers: headers() },
    { url: route(session), headers: { ...headers(f.cookie), 'x-company-id': f.otherCompany } },
  ];
  const results: unknown[] = [];
  for (const request of requests) {
    const result = await f.h.app.inject({ method: 'POST', ...request, payload: correctionInput() });
    expect(result.statusCode).toBe(404);
    results.push(result.json());
  }
  expect(results.every((row) => JSON.stringify(row) === JSON.stringify(results[0]))).toBe(true);
  await asRole(f, 'business_manager');
});

it('CA-07 refuses the paired device before any correction', async () => {
  const device = await paired(f.h, f.cookie, f.company, f.branch);
  const session = await seedSession(f);
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(session),
    headers: {
      authorization: `Device ${device.token}`,
      origin,
      'x-company-id': f.company,
      'idempotency-key': leaveIds.newId(),
    },
    payload: correctionInput(),
  });
  expect(result.statusCode).toBe(403);
  expect(result.json().code).toBe('FORBIDDEN');
  expect(await correctionRows(f, session)).toHaveLength(0);
});

it('maps open, revision, time and working-date errors to their bilingual HTTP status', async () => {
  const open = await seedSession(f, { status: 'OPEN', clockOut: null, closedBy: null });
  const closed = await seedSession(f);
  const cases = [
    { id: open, payload: correctionInput(), status: 409, code: 'ATTENDANCE_SESSION_OPEN' },
    {
      id: closed,
      payload: correctionInput(7),
      status: 409,
      code: 'ATTENDANCE_SESSION_REVISION_CONFLICT',
    },
    {
      id: closed,
      payload: correctionInput(0, { clock_out: '2027-01-01T00:00:00Z' }),
      status: 422,
      code: 'ATTENDANCE_CORRECTION_INVALID_TIMES',
    },
    {
      id: closed,
      payload: correctionInput(0, { clock_in: '2026-10-03T20:59:59Z' }),
      status: 422,
      code: 'ATTENDANCE_CORRECTION_WORKING_DATE',
    },
  ];
  for (const c of cases) {
    const result = await f.h.app.inject({
      method: 'POST',
      url: route(c.id),
      headers: headers(),
      payload: c.payload,
    });
    expect(result.statusCode).toBe(c.status);
    expect(result.json()).toMatchObject({
      code: c.code,
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  }
});
