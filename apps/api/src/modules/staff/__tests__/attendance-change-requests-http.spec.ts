import {
  attendanceChangeFixture,
  changeInput,
  changeAudits,
  changeEvents,
  effectCount,
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
it('ACR-13 preserves a kind refusal over HTTP and leaves PENDING without audit or event effects', async () => {
  const filed = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: changeInput(f),
  });
  expect(filed.statusCode).toBe(201);
  const row = attendanceChangeRequest.parse(filed.json());
  const audits = await changeAudits(f, row.id);
  const events = await changeEvents(f, row.id);
  const effects = await effectCount(f);
  f.control.kindRefusal = true;
  try {
    const response = await f.h.app.inject({
      method: 'POST',
      url: `${route()}/${row.id}/decide`,
      headers: headers(ownerCookie),
      payload: { decision: 'APPROVED', revision: 0 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'TEST_KIND_REFUSED',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
    expect(
      await f.h.owner`SELECT status,revision FROM attendance_change_requests WHERE id=${row.id}`,
    ).toEqual([{ status: 'PENDING', revision: 0 }]);
    expect(await changeAudits(f, row.id)).toEqual(audits);
    expect(await changeEvents(f, row.id)).toEqual(events);
    expect(await effectCount(f)).toEqual(effects);
  } finally {
    f.control.kindRefusal = false;
  }
});
it('ACR-09 out-of-scope and foreign ids share identical NOT_FOUND envelopes', async () => {
  await asRole(f, 'branch_manager');
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const input = {
    employee_id: f.employee.id,
    reason: 'void attendance',
    kind: 'VOID_SESSION',
    session_revision: 0,
    session_id,
  };
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

const grant = (
  membershipId: string,
  permission: string,
  scope: 'BRANCH' | 'BUSINESS',
  scopeId: string,
) =>
  f.h.app.inject({
    method: 'POST',
    url: `/v1/permissions/memberships/${membershipId}/overrides`,
    headers: headers(ownerCookie),
    payload: {
      permission_code: permission,
      effect: 'ALLOW',
      scope_type: scope,
      scope_id: scopeId,
      reason: 'Synthetic owner grant',
      expires_at: null,
    },
  });

it('ACR-Q1 owner grants an accountant permission to request only on the granted branch', async () => {
  await asRole(f, 'accountant');
  await f.h
    .owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business} WHERE id=${f.approverMember}`;
  const file = (payload = changeInput(f)) =>
    f.h.app.inject({
      method: 'POST',
      url: route(),
      headers: headers(),
      payload,
    });
  expect((await file()).statusCode).toBe(404);
  const allowed = await grant(
    f.approverMember,
    'request:attendance-change:branch',
    'BRANCH',
    f.branch,
  );
  expect(allowed.statusCode).toBe(201);
  const filed = await file();
  expect(filed.statusCode).toBe(201);
  expect(attendanceChangeRequest.parse(filed.json())).toMatchObject({
    status: 'PENDING',
    branch_id: f.branch,
    requested_by: f.approverId,
  });
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const outside = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: {
      employee_id: f.employee.id,
      reason: 'void attendance',
      kind: 'VOID_SESSION',
      session_revision: 0,
      session_id,
    },
  });
  expect(outside.statusCode).toBe(404);
  expect(outside.json().code).toBe('NOT_FOUND');
});

it('ACR-Q1 a non-owner permission administrator cannot grant the request permission', async () => {
  const management = await grant(f.memberId, 'manage:memberships:business', 'BUSINESS', f.business);
  expect(management.statusCode).toBe(201);
  const refused = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/permissions/memberships/${f.approverMember}/overrides`,
    headers: headers(f.cookie),
    payload: {
      permission_code: 'request:attendance-change:branch',
      effect: 'ALLOW',
      scope_type: 'BRANCH',
      scope_id: f.secondBranch,
      reason: 'Synthetic delegated grant',
      expires_at: null,
    },
  });
  expect(refused.statusCode).toBe(403);
  expect(refused.json().code).toBe('PERMISSION_OWNER_ONLY');
  const rows = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id=${f.approverMember}
    AND permission_code='request:attendance-change:branch' AND scope_id=${f.secondBranch}`;
  expect(rows).toHaveLength(0);
});

it('ACR-Q1 ignores a historical Device ALLOW for the request permission', async () => {
  await asRole(f, 'device');
  const allowed = await grant(
    f.approverMember,
    'request:attendance-change:branch',
    'BRANCH',
    f.branch,
  );
  expect(allowed.statusCode).toBe(403);
  expect(allowed.json().code).toBe('PERMISSION_ROLE_FORBIDDEN');
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'request:attendance-change:branch',
      'ALLOW','BRANCH',${f.secondBranch},'Synthetic historical device grant',${f.owner})`;
  const session_id = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const response = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: headers(),
    payload: {
      employee_id: f.employee.id,
      reason: 'void attendance',
      kind: 'VOID_SESSION',
      session_revision: 0,
      session_id,
    },
  });
  expect(response.statusCode).toBe(404);
  expect(response.json().code).toBe('NOT_FOUND');
  await asRole(f, 'business_manager');
});
