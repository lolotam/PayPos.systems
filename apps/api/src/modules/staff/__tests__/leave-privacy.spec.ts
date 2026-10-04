import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import {
  leaveActor,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';

let f: LeaveFixture;
let leaveId: string;
let ownCookie: string;
let device: { id: string; token: string };
beforeAll(async () => {
  f = await leaveFixture();
  device = await paired(f.h, f.cookie, f.company, f.branch);
  const staff = SYSTEM_ROLES.find((r) => r.code === 'staff');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id) VALUES(${f.company},${leaveIds.newId()},${f.userId},${staff?.id as string},'global','BRANCH',${f.branch})`;
  await f.h.owner`UPDATE "user" SET phone_number='+99900000009' WHERE id=${f.userId}`;
  await f.h
    .owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01T00:00:00Z' WHERE id=${f.userId}`;
  if (!f.h.auth.staff) throw new Error('Missing staff sessions');
  ownCookie =
    (
      await f.h.auth.staff.issue(
        f.userId,
        { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
  expect(
    await f.h.auth.staff.resolve(new Headers({ cookie: ownCookie }), {
      companyId: f.company,
      businessId: f.business,
      branchId: f.branch,
      deviceId: device.id,
    }),
  ).not.toBeNull();
  leaveId = (await f.request.execute(leaveActor(f), leaveTerms())).id;
  const manager = SYSTEM_ROLES.find((r) => r.code === 'branch_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${manager?.id as string},scope_type='BRANCH',scope_id=${f.branch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h
    .owner`DELETE FROM employee_branches WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const route = (employee: string) =>
  `/v1/businesses/${f.business}/employees/${employee}/leave-requests`;
const admin = () => ({
  cookie: f.cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});
const own = () => ({
  cookie: ownCookie,
  authorization: `Device ${device.token}`,
  origin,
  'idempotency-key': leaveIds.newId(),
});

it.each(['valid', 'reversed', 'ineligible'] as const)(
  'hides branch-B-only employee before %s period diagnostics on branch-A creation',
  async (period) => {
    const dates =
      period === 'reversed'
        ? leaveTerms('2027-01-02', '2027-01-01')
        : period === 'ineligible'
          ? leaveTerms('2025-01-01')
          : leaveTerms('2027-02-01');
    const request = (employee: string) =>
      f.h.app.inject({
        method: 'POST',
        url: route(employee),
        headers: admin(),
        payload: { ...dates, branch_id: f.branch },
      });
    const hidden = await request(f.employee.id),
      missing = await request(leaveIds.newId());
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  },
);
it('hides inaccessible employee history and cancellation exactly like missing employees, even with stale revision', async () => {
  for (const method of ['GET', 'POST'] as const) {
    const request = (employee: string) =>
      f.h.app.inject({
        method,
        url: method === 'GET' ? route(employee) : `${route(employee)}/${leaveId}/cancel`,
        headers: admin(),
        ...(method === 'POST' ? { payload: { expected_revision: 2 } } : {}),
      });
    const hidden = await request(f.employee.id),
      missing = await request(leaveIds.newId());
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  }
  const inbox = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/leave-requests`,
    headers: admin(),
  });
  expect(inbox.statusCode).toBe(200);
  expect(inbox.json().items).toEqual([]);
});
it('own create, cancel and history hide a caller outside the paired branch exactly like an unlinked caller', async () => {
  const requests = [
    {
      method: 'POST' as const,
      url: '/v1/staff/me/leave-requests',
      payload: leaveTerms('2027-02-01'),
    },
    {
      method: 'POST' as const,
      url: `/v1/staff/me/leave-requests/${leaveId}/cancel`,
      payload: { expected_revision: 2 },
    },
    { method: 'GET' as const, url: '/v1/staff/me/leave-requests' },
  ];
  const hidden = [];
  for (const request of requests) hidden.push(await f.h.app.inject({ ...request, headers: own() }));
  await f.h
    .owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  for (const [index, request] of requests.entries()) {
    const missing = await f.h.app.inject({ ...request, headers: own() });
    expect(hidden[index]?.statusCode).toBe(404);
    expect(hidden[index]?.json()).toEqual(missing.json());
  }
});
