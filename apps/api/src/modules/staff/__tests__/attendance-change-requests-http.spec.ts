import {
  attendanceChangeFixture,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequest, attendanceChangeDecisionResult } from '@pospay/contracts';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
let f: ChangeFixture;
let ownerCookie: string;
beforeAll(async () => {
  f = await attendanceChangeFixture();
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
it('ACR-01/02/11 returns contracts, requires keys and replays unchanged bodies', async () => {
  const request = {
    method: 'POST' as const,
    url: route(),
    headers: headers(),
    payload: changeInput(f),
  };
  const response = await f.h.app.inject(request);
  expect(response.statusCode).toBe(201);
  const row = attendanceChangeRequest.parse(response.json());
  expect((await f.h.app.inject(request)).json()).toEqual(row);
  expect(
    (await f.h.app.inject({ ...request, payload: { ...request.payload, reason: 'other' } })).json()
      .code,
  ).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(
    (
      await f.h.app.inject({
        ...request,
        headers: { cookie: f.approverCookie, 'x-company-id': f.company },
      })
    ).json().code,
  ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  const decided = await f.h.app.inject({
    method: 'POST',
    url: `${route()}/${row.id}/decide`,
    headers: headers(ownerCookie),
    payload: { decision: 'APPROVED', revision: 0 },
  });
  expect(decided.statusCode).toBe(200);
  expect(attendanceChangeDecisionResult.parse(decided.json()).status).toBe('APPROVED');
});
it('ACR-03 validates reason and decision envelopes', async () => {
  for (const reason of ['', ' ', 'x'.repeat(501)]) {
    const response = await f.h.app.inject({
      method: 'POST',
      url: route(),
      headers: headers(),
      payload: { ...changeInput(f), reason },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'VALIDATION_FAILED',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  }
  const rejected = await f.h.app.inject({
    method: 'POST',
    url: `${route()}/${leaveIds.newId()}/decide`,
    headers: headers(ownerCookie),
    payload: { decision: 'REJECTED', revision: 0 },
  });
  expect(rejected.statusCode).toBe(400);
});
it('ACR-09 out-of-scope and foreign ids share identical NOT_FOUND envelopes', async () => {
  await asRole(f, 'branch_manager');
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const input = { ...changeInput(f), kind: 'VOID_SESSION', session_id };
  const responses: unknown[] = [];
  for (const request of [
    { url: route(), payload: input },
    { url: route(), payload: { ...input, session_id: leaveIds.newId() } },
    { url: route().replace(f.business, f.secondBusiness), payload: input },
  ]) {
    const response = await f.h.app.inject({ method: 'POST', ...request, headers: headers() });
    expect(response.statusCode).toBe(404);
    responses.push(response.json());
  }
  expect(responses.every((r) => JSON.stringify(r) === JSON.stringify(responses[0]))).toBe(true);
  await asRole(f, 'business_manager');
});
it('ACR-10 refuses paired devices on all four routes', async () => {
  const device = await paired(f.h, f.cookie, f.company, f.branch);
  const deviceHeaders = {
    authorization: `Device ${device.token}`,
    origin,
    'x-company-id': f.company,
    'idempotency-key': leaveIds.newId(),
  };
  for (const request of [
    { method: 'POST' as const, url: route(), payload: changeInput(f) },
    {
      method: 'POST' as const,
      url: `${route()}/${leaveIds.newId()}/cancel`,
      payload: { revision: 0 },
    },
    {
      method: 'POST' as const,
      url: `${route()}/${leaveIds.newId()}/decide`,
      payload: { decision: 'APPROVED', revision: 0 },
    },
    { method: 'GET' as const, url: route() },
  ]) {
    const response = await f.h.app.inject({ ...request, headers: deviceHeaders });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  }
});
