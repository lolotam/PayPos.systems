import { leavePage, ownLeaveWriteResult } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { personalFixture, personalOrigin } from '../../../../test/personal-staff.fixture.ts';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { createPersonalEligibility } from '../persistence/personal-employee.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import { leaveTerms } from './leave.fixture.ts';

let f: Awaited<ReturnType<typeof personalFixture>>;
let cookie: string;
let managerUser: string;
let madeByManager: string;
beforeAll(async () => {
  f = await personalFixture();
  const manager = SYSTEM_ROLES.find((role) => role.code === 'business_manager');
  if (!manager) throw new Error('Missing manager role');
  await f.owner`UPDATE memberships SET role_id=${manager.id},scope_type='BUSINESS',scope_id=${f.businessId}
    WHERE company_id=${f.companyId} AND id=${f.membershipId}`;
  managerUser = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${managerUser},'Synthetic leave manager','own-leave-cancel-authority-manager@example.test')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.companyId},${f.ids.newId()},${managerUser},${manager.id},'global','BUSINESS',${f.businessId},'2026-01-01')`;
  const request = new RequestLeaveUseCase(createLeaveTransactions(f.database, f.ids), f.ids, {
    now: () => new Date(),
  });
  const key = f.ids.newId();
  madeByManager = (
    await request.execute(
      {
        companyId: f.companyId,
        businessId: f.businessId,
        branchId: f.branchId,
        userId: managerUser,
        employeeId: f.employeeId,
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
const headers = (key = f.ids.newId()) => ({
  cookie,
  origin: personalOrigin,
  'idempotency-key': key,
});
const path = (suffix = '', branch = f.branchId) =>
  `/v1/staff/me/leave-requests${suffix}?branch_id=${branch}`;

it('own writes answer the written request plus the live server-decided can_cancel', async () => {
  const created = await f.app.inject({
    method: 'POST',
    url: path(),
    headers: headers(),
    payload: leaveTerms('2027-03-01'),
  });
  expect(created.statusCode).toBe(201);
  const row = ownLeaveWriteResult.parse(created.json());
  expect(row).toMatchObject({ employee_id: f.employeeId, status: 'PENDING', revision: 1 });
  expect(row.can_cancel).toBe(true);
  const cancelled = await f.app.inject({
    method: 'POST',
    url: path(`/${row.id}/cancel`),
    headers: headers(),
    payload: { expected_revision: row.revision },
  });
  expect(cancelled.statusCode).toBe(200);
  expect(ownLeaveWriteResult.parse(cancelled.json())).toMatchObject({
    id: row.id,
    status: 'CANCELLED',
    revision: 2,
    can_cancel: false,
  });
});

it('a cancel DENY answers create with can_cancel false and refuses the cancel itself', async () => {
  const deny = f.ids.newId();
  await f.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,scope_type,scope_id,effect,reason,granted_by)
    VALUES(${f.companyId},${deny},${f.membershipId},'cancel:leave:own','BRANCH',${f.branchId},'DENY','Synthetic cancel DENY',${f.userId})`;
  const created = await f.app.inject({
    method: 'POST',
    url: path(),
    headers: headers(),
    payload: leaveTerms('2027-04-01'),
  });
  expect(created.statusCode).toBe(201);
  expect(ownLeaveWriteResult.parse(created.json()).can_cancel).toBe(false);
  const row = ownLeaveWriteResult.parse(created.json());
  const refused = await f.app.inject({
    method: 'POST',
    url: path(`/${row.id}/cancel`),
    headers: headers(),
    payload: { expected_revision: row.revision },
  });
  expect(refused.statusCode).toBe(404);
  expect(refused.json().code).toBe('NOT_FOUND');
  await f.owner`DELETE FROM permission_overrides WHERE company_id=${f.companyId} AND id=${deny}`;
});

it('an idempotent create replay answers the authority of the moment, not the stored one', async () => {
  const key = f.ids.newId();
  const request = {
    method: 'POST' as const,
    url: path(),
    headers: headers(key),
    payload: leaveTerms('2027-05-01'),
  };
  const first = await f.app.inject(request);
  expect(first.statusCode).toBe(201);
  const row = ownLeaveWriteResult.parse(first.json());
  expect(row.can_cancel).toBe(true);
  const cancelled = await f.app.inject({
    method: 'POST',
    url: path(`/${row.id}/cancel`),
    headers: headers(),
    payload: { expected_revision: row.revision },
  });
  expect(cancelled.statusCode).toBe(200);
  const replay = await f.app.inject(request);
  expect(replay.statusCode).toBe(201);
  const replayed = ownLeaveWriteResult.parse(replay.json());
  expect(replayed.id).toBe(row.id);
  expect(replayed.can_cancel).toBe(false);
});

it('a request made for her by a manager shows her no cancel authority anywhere', async () => {
  const list = await f.app.inject({ method: 'GET', url: path(), headers: headers() });
  expect(list.statusCode).toBe(200);
  expect(leavePage.parse(list.json()).items).toContainEqual(
    expect.objectContaining({ id: madeByManager, can_cancel: false }),
  );
  const refused = await f.app.inject({
    method: 'POST',
    url: path(`/${madeByManager}/cancel`),
    headers: headers(),
    payload: { expected_revision: 1 },
  });
  expect(refused.statusCode).toBe(404);
  expect(refused.json().code).toBe('NOT_FOUND');
});
