import { afterAll, beforeAll, expect, it } from 'vitest';
import { leavePage, leaveRequest } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { paired, origin } from '../../../../test/staff-otp-harness.ts';
import { leaveFixture, leaveIds, leaveTerms, type LeaveFixture } from './leave.fixture.ts';
let f: LeaveFixture;
let device: { id: string; token: string };
let staffCookie: string;
beforeAll(async () => {
  f = await leaveFixture();
  device = await paired(f.h, f.cookie, f.company, f.branch);
  const staffRole = SYSTEM_ROLES.find((r) => r.code === 'staff');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id) VALUES(${f.company},${leaveIds.newId()},${f.userId},${staffRole?.id as string},'global','BRANCH',${f.branch})`;
  if (!f.h.auth.staff) throw new Error('Missing staff sessions');
  await f.h.owner`UPDATE "user" SET phone_number='+99900000009' WHERE id=${f.userId}`;
  await f.h
    .owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01T00:00:00Z' WHERE id=${f.userId}`;
  staffCookie =
    (
      await f.h.auth.staff.issue(
        f.userId,
        { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  const context = {
    companyId: f.company,
    businessId: f.business,
    branchId: f.branch,
    deviceId: device.id,
  };
  expect(typeof device.token).toBe('string');
  expect(
    await f.h.auth.staff.resolve(new Headers({ cookie: staffCookie }), context),
  ).not.toBeNull();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const admin = () => ({
  cookie: f.cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});
const own = () => ({
  cookie: staffCookie,
  authorization: `Device ${device.token}`,
  origin,
  'idempotency-key': leaveIds.newId(),
});
const route = () => `/v1/businesses/${f.business}/employees/${f.employee.id}/leave-requests`;
const ownPayload = {
  kind: 'PARTIAL',
  date: '2027-02-01',
  start: '09:00',
  end: '12:00',
  type: 'SICK',
};
it.each([
  { input: { ...ownPayload, start: '09:07' }, code: 'LEAVE_TIME_STEP_INVALID' },
  { input: { ...ownPayload, end: '12:07' }, code: 'LEAVE_TIME_STEP_INVALID' },
  {
    input: { kind: 'FULL_DAY', type: 'SICK', from: '2027-01-01', to: '2027-04-01' },
    code: 'LEAVE_SPAN_TOO_LONG',
  },
])('returns bilingual named $code on both creation routes', async ({ input, code }) => {
  for (const isOwn of [false, true]) {
    const result = await f.h.app.inject({
      method: 'POST',
      url: isOwn ? '/v1/staff/me/leave-requests' : route(),
      headers: isOwn ? own() : admin(),
      payload: isOwn ? input : { ...input, branch_id: f.branch },
    });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toMatchObject({
      code,
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  }
});
it('serves admin contracts, missing idempotency, named overlap/conflict and inbox', async () => {
  const payload = { ...leaveTerms(), branch_id: f.branch };
  const headers = admin();
  const result = await f.h.app.inject({ method: 'POST', url: route(), headers, payload });
  expect(result.statusCode).toBe(201);
  const row = leaveRequest.parse(result.json());
  const replay = await f.h.app.inject({ method: 'POST', url: route(), headers, payload });
  expect(replay.json()).toEqual(row);
  const missing = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload,
  });
  expect(missing.statusCode).toBe(400);
  const overlap = await f.h.app.inject({ method: 'POST', url: route(), headers: admin(), payload });
  expect(overlap.statusCode).toBe(409);
  expect(overlap.json().code).toBe('LEAVE_OVERLAP');
  const inbox = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/leave-requests`,
    headers: admin(),
  });
  expect(inbox.statusCode).toBe(200);
  expect(leavePage.parse(inbox.json()).items.map((r) => r.id)).toContain(row.id);
  const conflict = await f.h.app.inject({
    method: 'POST',
    url: `${route()}/${row.id}/cancel`,
    headers: admin(),
    payload: { expected_revision: 2 },
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json().code).toBe('LEAVE_REVISION_CONFLICT');
});
it('own route derives identity only from staff session, refuses injected IDs and bad origin, and cancels own pending leave', async () => {
  const payload = ownPayload;
  const headers = own();
  const result = await f.h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/leave-requests',
    headers,
    payload,
  });
  expect(result.statusCode).toBe(201);
  const row = leaveRequest.parse(result.json());
  expect(row.employee_id).toBe(f.employee.id);
  expect(row.requested_by).toBe(f.userId);
  expect(
    (
      await f.h.app.inject({ method: 'POST', url: '/v1/staff/me/leave-requests', headers, payload })
    ).json(),
  ).toEqual(row);
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: '/v1/staff/me/leave-requests',
        headers: own(),
        payload: { ...payload, employee_id: leaveIds.newId() },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await f.h.app.inject({
        method: 'GET',
        url: '/v1/staff/me/leave-requests',
        headers: { ...own(), origin: 'http://foreign.synthetic.invalid' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await f.h.app.inject({
        method: 'GET',
        url: '/v1/staff/me/leave-requests',
        headers: { ...own(), cookie: '' },
      })
    ).statusCode,
  ).toBe(401);
  const cancel = await f.h.app.inject({
    method: 'POST',
    url: `/v1/staff/me/leave-requests/${row.id}/cancel`,
    headers: own(),
    payload: { expected_revision: 1 },
  });
  expect(cancel.statusCode).toBe(200);
  expect(cancel.json().status).toBe('CANCELLED');
});
it('own requester cannot cancel a request made by another manager; unlinking the employee hides own history', async () => {
  const [owner] = await f.h.owner`SELECT id FROM "user" WHERE email='employee-owner@example.test'`;
  const made = await f.request.execute(
    {
      companyId: f.company,
      userId: owner?.['id'] as string,
      businessId: f.business,
      branchId: f.branch,
      employeeId: f.employee.id,
      own: false,
      key: leaveIds.newId(),
      fingerprint: 'synthetic-owner-leave',
    },
    leaveTerms('2027-02-02'),
  );
  const history = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/leave-requests',
    headers: own(),
  });
  expect(history.statusCode).toBe(200);
  expect(leavePage.parse(history.json()).items.find((r) => r.id === made.id)?.can_cancel).toBe(
    false,
  );
  const refused = await f.h.app.inject({
    method: 'POST',
    url: `/v1/staff/me/leave-requests/${made.id}/cancel`,
    headers: own(),
    payload: { expected_revision: 1 },
  });
  expect(refused.statusCode).toBe(404);
  await f.h
    .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(
    (await f.h.app.inject({ method: 'GET', url: '/v1/staff/me/leave-requests', headers: own() }))
      .statusCode,
  ).toBe(404);
  await f.h
    .owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.employee.id}`;
});
it('own requester sees and cancels their pending leave from another paired branch context', async () => {
  const made = await f.request.execute(
    {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      branchId: f.secondBranch,
      employeeId: f.employee.id,
      own: false,
      key: leaveIds.newId(),
      fingerprint: 'synthetic-transfer',
    },
    leaveTerms('2027-02-03'),
  );
  const history = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/leave-requests',
    headers: own(),
  });
  expect(leavePage.parse(history.json()).items.find((r) => r.id === made.id)?.can_cancel).toBe(
    true,
  );
  const cancelled = await f.h.app.inject({
    method: 'POST',
    url: `/v1/staff/me/leave-requests/${made.id}/cancel`,
    headers: own(),
    payload: { expected_revision: 1 },
  });
  expect(cancelled.statusCode).toBe(200);
  expect(cancelled.json()).toMatchObject({
    status: 'CANCELLED',
    branch_id: f.secondBranch,
    timezone: made.timezone,
  });
});
it('branch manager is scoped, historical Device grants cannot bypass policy, and own DENY beats defaults', async () => {
  const role = SYSTEM_ROLES.find((r) => r.code === 'branch_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type='BRANCH',scope_id=${f.branch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  const out = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: admin(),
    payload: { ...leaveTerms('2027-03-01'), branch_id: f.secondBranch },
  });
  expect(out.statusCode).toBe(404);
  expect(out.json().code).toBe('NOT_FOUND');
  const inside = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: admin(),
    payload: { ...leaveTerms('2027-03-01'), branch_id: f.branch },
  });
  expect(inside.statusCode).toBe(201);
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by) VALUES(${f.company},${leaveIds.newId()},${f.memberId},'read:leave:own','DENY','BRANCH',${f.branch},'Synthetic own denial',${f.userId})`;
  expect(
    (await f.h.app.inject({ method: 'GET', url: '/v1/staff/me/leave-requests', headers: own() }))
      .statusCode,
  ).toBe(404);
  const deviceRole = SYSTEM_ROLES.find((r) => r.code === 'device');
  await f.h
    .owner`UPDATE memberships SET role_id=${deviceRole?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by) VALUES(${f.company},${leaveIds.newId()},${f.memberId},'create:leave:branch','ALLOW','BRANCH',${f.branch},'Synthetic historical grant',${f.userId})`;
  const forbidden = await f.h.app.inject({
    method: 'POST',
    url: route(),
    headers: admin(),
    payload: { ...leaveTerms('2027-04-01'), branch_id: f.branch },
  });
  expect(forbidden.statusCode).toBe(404);
});
