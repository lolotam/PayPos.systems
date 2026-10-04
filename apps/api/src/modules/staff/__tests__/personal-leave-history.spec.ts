import { leavePage, leaveRequest } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
import { DecideLeaveUseCase } from '../use-cases/decide-leave/decide-leave.usecase.ts';
import { leaveTerms } from './leave.fixture.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let cookie: string;
let secondBranch: string;
const role = (code: string) => {
  const found = SYSTEM_ROLES.find((r) => r.code === code);
  if (!found) throw new Error(`Missing ${code} role`);
  return found.id;
};
beforeAll(async () => {
  f = await personalFixture();
  secondBranch = f.ids.newId();
  await f.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.companyId},${secondBranch},${f.businessId},'Synthetic second leave branch')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${secondBranch},'2026-01-01')`;
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
const path = (branch: string) => `/v1/staff/me/leave-requests?branch_id=${branch}`;

async function approveAsAnotherManager(leaveId: string) {
  const approver = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${approver},'Synthetic approver','personal-history-approver@example.test')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.companyId},${f.ids.newId()},${approver},${role('business_manager')},'global','BUSINESS',${f.businessId},'2026-01-01')`;
  const key = f.ids.newId();
  await new DecideLeaveUseCase(createLeaveTransactions(f.database, f.ids), {
    now: () => new Date(),
  }).execute(
    {
      companyId: f.companyId,
      userId: approver,
      businessId: f.businessId,
      employeeId: f.employeeId,
      leaveId,
      own: false,
      key,
      fingerprint: key,
    },
    { decision: 'APPROVED', expected_revision: 1, reason: 'Synthetic approval' },
  );
  return approver;
}

it('own history stays business-wide: a session selected on one branch lists a decided leave saved in another', async () => {
  await f.owner`UPDATE memberships SET role_id=${role('business_manager')},scope_type='BUSINESS',scope_id=${f.businessId}
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  const created = await f.app.inject({
    method: 'POST',
    url: path(secondBranch),
    headers: headers(),
    payload: leaveTerms('2027-08-01'),
  });
  expect(created.statusCode).toBe(201);
  const leave = leaveRequest.parse(created.json());
  expect(leave.branch_id).toBe(secondBranch);
  await f.owner`UPDATE memberships SET role_id=${role('staff')},scope_type='BRANCH',scope_id=${f.branchId}
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  const approver = await approveAsAnotherManager(leave.id);
  const list = await f.app.inject({ method: 'GET', url: path(f.branchId), headers: headers() });
  expect(list.statusCode).toBe(200);
  expect(leavePage.parse(list.json()).items).toContainEqual(
    expect.objectContaining({
      id: leave.id,
      branch_id: secondBranch,
      status: 'APPROVED',
      decided_by: approver,
      decision_reason: 'Synthetic approval',
      can_decide: false,
      can_revoke: false,
    }),
  );
});
