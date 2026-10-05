import { leavePage, leaveRequest } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { DecideLeaveUseCase } from '../use-cases/decide-leave/decide-leave.usecase.ts';
import { leaveTerms } from './leave.fixture.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let cookie: string;
let otherEmployee: string;
let otherLeave: string;
let ownLeave: string;
let unattachedBranch: string;
beforeAll(async () => {
  f = await personalFixture();
  const manager = SYSTEM_ROLES.find((role) => role.code === 'business_manager');
  if (!manager) throw new Error('Missing manager role');
  await f.owner`UPDATE memberships SET role_id=${manager.id},scope_type='BUSINESS',scope_id=${f.businessId}
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  otherEmployee = f.ids.newId();
  unattachedBranch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.companyId},${unattachedBranch},${f.businessId},'Synthetic unattached leave branch')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${f.companyId},${otherEmployee},${f.businessId},${f.branchId},'Synthetic other employee','staff','2026-01-01')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${otherEmployee},${f.branchId},'2026-01-01')`;
  const request = new RequestLeaveUseCase(createLeaveTransactions(f.database, f.ids), f.ids, {
    now: () => new Date(),
  });
  const key = f.ids.newId();
  otherLeave = (
    await request.execute(
      {
        companyId: f.companyId,
        businessId: f.businessId,
        branchId: f.branchId,
        userId: f.userId,
        employeeId: otherEmployee,
        own: false,
        key,
        fingerprint: key,
      },
      leaveTerms('2027-02-01'),
    )
  ).id;
  const issued = await f.auth.personal.issue(
    f.userId,
    { purpose: 'STAFF_PERSONAL', companyId: f.companyId, businessId: f.businessId },
    () =>
      createPersonalEligibility(f.database).eligible(f.userId, {
        companyId: f.companyId,
        businessId: f.businessId,
      }),
  );
  cookie = issued.cookie.split(';')[0] ?? '';
});
afterAll(async () => {
  await f?.close();
});
const headers = () => ({ cookie, origin: personalOrigin, 'idempotency-key': f.ids.newId() });
const path = (suffix = '', branch = f.branchId) =>
  `/v1/staff/me/leave-requests${suffix}?branch_id=${branch}`;

it('LIMITED personal sessions create, replay, list and cancel their own leave without a Device', async () => {
  const input = leaveTerms('2027-03-01');
  const request = { method: 'POST' as const, url: path(), headers: headers(), payload: input };
  const made = await f.app.inject(request);
  expect(made.statusCode).toBe(201);
  const row = leaveRequest.parse(made.json());
  ownLeave = row.id;
  expect(row).toMatchObject({
    employee_id: f.employeeId,
    branch_id: f.branchId,
    requested_by: f.userId,
  });
  expect((await f.app.inject(request)).json()).toEqual(row);
  const list = await f.app.inject({ method: 'GET', url: path(), headers: headers() });
  expect(list.statusCode).toBe(200);
  expect(leavePage.parse(list.json()).items).toEqual([
    expect.objectContaining({ id: ownLeave, can_cancel: true }),
  ]);
  const cancelled = await f.app.inject({
    method: 'POST',
    url: path(`/${ownLeave}/cancel`),
    headers: headers(),
    payload: { expected_revision: 1 },
  });
  expect(cancelled.statusCode).toBe(200);
  expect(leaveRequest.parse(cancelled.json())).toMatchObject({
    id: ownLeave,
    status: 'CANCELLED',
    revision: 2,
  });
});

it('hides another employee leave exactly like an unknown leave and rejects employee identity injection', async () => {
  const cancel = (id: string) =>
    f.app.inject({
      method: 'POST',
      url: path(`/${id}/cancel`),
      headers: headers(),
      payload: { expected_revision: 1 },
    });
  const hidden = await cancel(otherLeave),
    missing = await cancel(f.ids.newId());
  expect(hidden.statusCode).toBe(404);
  expect(hidden.json()).toEqual(missing.json());
  for (const payload of [
    { ...leaveTerms('2027-04-01'), employee_id: otherEmployee },
    { ...leaveTerms('2027-04-01'), business_id: f.ids.newId() },
  ]) {
    expect(
      (await f.app.inject({ method: 'POST', url: path(), headers: headers(), payload })).statusCode,
    ).toBe(400);
  }
  expect(
    (
      await f.app.inject({
        method: 'GET',
        url: `${path()}&employee_id=${otherEmployee}`,
        headers: headers(),
      })
    ).statusCode,
  ).toBe(400);
});

it('cannot enter manager routes even with a live business-manager membership or a substituted admin cookie', async () => {
  const base = `/v1/businesses/${f.businessId}/employees/${otherEmployee}/leave-requests`;
  const requests = [
    { method: 'GET' as const, url: base },
    {
      method: 'POST' as const,
      url: base,
      payload: { ...leaveTerms('2027-04-01'), branch_id: f.branchId },
    },
    {
      method: 'POST' as const,
      url: `${base}/${otherLeave}/cancel`,
      payload: { expected_revision: 1 },
    },
    { method: 'GET' as const, url: `/v1/businesses/${f.businessId}/leave-requests` },
  ];
  for (const request of requests) {
    const result = await f.app.inject({
      ...request,
      headers: { ...headers(), 'x-company-id': f.companyId },
    });
    expect(result.statusCode).toBe(401);
    expect(result.json().code).toBe('UNAUTHENTICATED');
  }
  const substituted = cookie.replace('pospay-personal.session_token', 'pospay.session_token');
  expect(
    (
      await f.app.inject({
        method: 'GET',
        url: base,
        headers: { ...headers(), cookie: substituted, 'x-company-id': f.companyId },
      })
    ).statusCode,
  ).toBe(401);
});

it('requires the personal branch query and refuses unattached branches on every own route', async () => {
  for (const branch of [undefined, unattachedBranch]) {
    for (const request of [
      { method: 'GET' as const, suffix: '' },
      { method: 'POST' as const, suffix: '', payload: leaveTerms('2027-04-01') },
      { method: 'POST' as const, suffix: `/${ownLeave}/cancel`, payload: { expected_revision: 2 } },
    ]) {
      const { suffix, ...input } = request;
      const result = await f.app.inject({
        ...input,
        url: branch === undefined ? `/v1/staff/me/leave-requests${suffix}` : path(suffix, branch),
        headers: headers(),
      });
      expect(result.statusCode).toBe(branch === undefined ? 400 : 404);
    }
  }
});

it('preserves non-owner covering DENY and canonical owner immunity for personal own requests', async () => {
  const deny = f.ids.newId();
  await f.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,scope_type,scope_id,effect,reason,granted_by)
    VALUES(${f.companyId},${deny},${f.membershipId},'create:leave:own','BRANCH',${f.branchId},'DENY','Synthetic historical own DENY',${f.userId})`;
  const create = () =>
    f.app.inject({
      method: 'POST',
      url: path(),
      headers: headers(),
      payload: leaveTerms('2027-05-01'),
    });
  expect((await create()).statusCode).toBe(404);
  await f.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},scope_type='COMPANY',scope_id=${f.companyId}
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  expect((await create()).statusCode).toBe(201);
  await f.owner`DELETE FROM permission_overrides WHERE company_id=${f.companyId} AND id=${deny}`;
});

it('personal own history shows decision/reason but grants no manager decision or notification inbox access', async () => {
  const created = await f.app.inject({
    method: 'POST',
    url: path(),
    headers: headers(),
    payload: leaveTerms('2027-06-01'),
  });
  expect(created.statusCode).toBe(201);
  const row = leaveRequest.parse(created.json());
  const approver = f.ids.newId();
  const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${approver},'Synthetic approver','personal-leave-approver@example.test')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at) VALUES(${f.companyId},${f.ids.newId()},${approver},${manager?.id as string},'global','BUSINESS',${f.businessId},'2026-01-01')`;
  const key = f.ids.newId();
  await new DecideLeaveUseCase(createLeaveTransactions(f.database, f.ids), {
    now: () => new Date(),
  }).execute(
    {
      companyId: f.companyId,
      userId: approver,
      businessId: f.businessId,
      employeeId: f.employeeId,
      leaveId: row.id,
      own: false,
      key,
      fingerprint: key,
    },
    { decision: 'REJECTED', expected_revision: 1, reason: 'Synthetic refusal' },
  );
  const list = await f.app.inject({ method: 'GET', url: path(), headers: headers() });
  expect(leavePage.parse(list.json()).items).toContainEqual(
    expect.objectContaining({
      id: row.id,
      status: 'REJECTED',
      decision_reason: 'Synthetic refusal',
      rejection_reason: 'Synthetic refusal',
      can_decide: false,
      can_revoke: false,
    }),
  );
});
it('personal credentials cannot reach decisions, revocations or the normal-session inbox', async () => {
  const base = `/v1/businesses/${f.businessId}/employees/${f.employeeId}/leave-requests/${ownLeave}`;
  for (const action of ['decide', 'revoke'])
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: `${base}/${action}`,
          headers: { ...headers(), 'x-company-id': f.companyId },
          payload:
            action === 'decide'
              ? { decision: 'APPROVED', expected_revision: 1 }
              : { expected_revision: 2, reason: 'Synthetic' },
        })
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await f.app.inject({
        method: 'GET',
        url: '/v1/me/notifications',
        headers: { ...headers(), 'x-company-id': f.companyId },
      })
    ).statusCode,
  ).toBe(401);
});
it('rechecks live employee eligibility and refuses a wrong origin, Device substitution and relinking', async () => {
  for (const extra of [
    { origin: 'http://localhost:9999' },
    { authorization: 'Device synthetic' },
  ]) {
    expect(
      (await f.app.inject({ method: 'GET', url: path(), headers: { ...headers(), ...extra } }))
        .statusCode,
    ).toBe(401);
  }
  await f.owner`UPDATE employees SET contract_end='2026-01-02' WHERE company_id=${f.companyId} AND id=${f.employeeId}`;
  expect((await f.app.inject({ method: 'GET', url: path(), headers: headers() })).statusCode).toBe(
    404,
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: path(),
        headers: headers(),
        payload: leaveTerms('2027-06-01'),
      })
    ).statusCode,
  ).toBe(404);
  await f.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.companyId} AND id=${f.employeeId}`;
  expect((await f.app.inject({ method: 'GET', url: path(), headers: headers() })).statusCode).toBe(
    401,
  );
});
