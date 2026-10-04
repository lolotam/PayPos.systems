import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { leavePage, leaveRequest } from '@pospay/contracts';
import {
  decisionActor,
  leaveDecisionFixture,
  type LeaveDecisionFixture,
} from './leave-decision.fixture.ts';
import { leaveActor, leaveIds, leaveTerms } from './leave.fixture.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
let f: LeaveDecisionFixture;
let ownCookie: string;
let device: { id: string; token: string };
beforeAll(async () => {
  f = await leaveDecisionFixture();
  device = await paired(f.h, f.cookie, f.company, f.branch);
  const staff = SYSTEM_ROLES.find((r) => r.code === 'staff');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id) VALUES(${f.company},${leaveIds.newId()},${f.userId},${staff?.id as string},'global','BRANCH',${f.branch})`;
  await f.h.owner`UPDATE "user" SET phone_number='+99900000009' WHERE id=${f.userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at='2026-01-01' WHERE id=${f.userId}`;
  if (!f.h.auth.staff) throw new Error('Missing staff sessions');
  ownCookie =
    (
      await f.h.auth.staff.issue(
        f.userId,
        { companyId: f.company, businessId: f.business, branchId: f.branch, deviceId: device.id },
        async () => true,
      )
    ).cookie.split(';')[0] ?? '';
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const headers = () => ({
  cookie: f.approverCookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});
const route = (leaveId: string, action = 'decide', employeeId = f.employee.id) =>
  `/v1/businesses/${f.business}/employees/${employeeId}/leave-requests/${leaveId}/${action}`;
const approval = { decision: 'APPROVED', expected_revision: 1, reason: '  Synthetic approval  ' };

it('returns contracts, requires idempotency, pins revisions and shows decision/reason in kiosk own list', async () => {
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-11-01'));
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(row.id),
    headers: headers(),
    payload: approval,
  });
  expect(result.statusCode).toBe(200);
  expect(leaveRequest.parse(result.json())).toMatchObject({
    status: 'APPROVED',
    decision_reason: 'Synthetic approval',
    revision: 2,
  });
  const history = await f.h.app.inject({
    method: 'GET',
    url: '/v1/staff/me/leave-requests',
    headers: { cookie: ownCookie, authorization: `Device ${device.token}`, origin },
  });
  expect(history.statusCode).toBe(200);
  expect(leavePage.parse(history.json()).items).toContainEqual(
    expect.objectContaining({
      id: row.id,
      decision_reason: 'Synthetic approval',
      can_decide: false,
      can_revoke: false,
    }),
  );
  const refused = await f.h.app.inject({
    method: 'POST',
    url: route(row.id, 'revoke'),
    headers: { ...headers(), cookie: ownCookie, authorization: `Device ${device.token}`, origin },
    payload: { expected_revision: 2, reason: 'Synthetic reason' },
  });
  expect(refused.statusCode).toBe(403);
  expect(refused.json().code).toBe('FORBIDDEN');
  const revoke = await f.h.app.inject({
    method: 'POST',
    url: route(row.id, 'revoke'),
    headers: headers(),
    payload: { expected_revision: 2, reason: 'Synthetic correction' },
  });
  expect(revoke.statusCode).toBe(200);
  const missingKey = await f.h.app.inject({
    method: 'POST',
    url: route(row.id),
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
    payload: approval,
  });
  expect(missingKey.statusCode).toBe(400);
  expect(missingKey.json().code).toBe('IDEMPOTENCY_KEY_REQUIRED');
});
it('refuses self-decision with bilingual named error even when requested by another manager', async () => {
  const row = await f.request.execute(
    { ...leaveActor(f), userId: f.approverId },
    leaveTerms('2027-11-02'),
  );
  const result = await f.h.app.inject({
    method: 'POST',
    url: route(row.id),
    headers: { ...headers(), cookie: f.cookie },
    payload: approval,
  });
  expect(result.statusCode).toBe(403);
  expect(result.json()).toMatchObject({
    code: 'LEAVE_SELF_DECISION_FORBIDDEN',
    message_ar: expect.any(String),
    message_en: expect.any(String),
  });
});
it('the existing in-app inbox cannot serve a kiosk staff recipient', async () => {
  const response = await f.h.app.inject({
    method: 'GET',
    url: '/v1/me/notifications',
    headers: {
      cookie: ownCookie,
      authorization: `Device ${device.token}`,
      origin,
      'x-company-id': f.company,
    },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('FORBIDDEN');
});
it('canonical owner immunity survives historical decision DENY but cannot bypass self-decision', async () => {
  const role = SYSTEM_ROLES.find((r) => r.code === 'owner');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type='COMPANY',scope_id=${f.company} WHERE id=${f.approverMember}`;
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by) VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'decide:leave:branch','DENY','BRANCH',${f.branch},'Synthetic historical owner denial',${f.userId})`;
  const row = await f.request.execute(leaveActor(f), leaveTerms('2027-11-03'));
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: route(row.id),
        headers: headers(),
        payload: approval,
      })
    ).statusCode,
  ).toBe(200);
  await f.h.owner`UPDATE employees SET user_id=${f.approverId} WHERE id=${f.employee.id}`;
  const self = await f.h.app.inject({
    method: 'POST',
    url: route(row.id, 'revoke'),
    headers: headers(),
    payload: { expected_revision: 2, reason: 'Synthetic' },
  });
  expect(self.json().code).toBe('LEAVE_SELF_DECISION_FORBIDDEN');
  await f.h.owner`UPDATE employees SET user_id=${f.userId} WHERE id=${f.employee.id}`;
  await f.h.owner`DELETE FROM permission_overrides WHERE membership_id=${f.approverMember}`;
});
it.each(['decide', 'revoke'])(
  'unknown/inaccessible %s has identical complete envelopes for valid and invalid bodies',
  async (action) => {
    const row = await f.request.execute(
      { ...leaveActor(f), branchId: f.secondBranch },
      leaveTerms(action === 'decide' ? '2027-12-01' : '2027-12-02'),
    );
    if (action === 'revoke')
      await f.decide.execute(decisionActor(f, row.id), {
        decision: 'APPROVED',
        expected_revision: 1,
      });
    const manager = SYSTEM_ROLES.find((r) => r.code === 'branch_manager');
    await f.h
      .owner`UPDATE memberships SET role_id=${manager?.id as string},scope_type='BRANCH',scope_id=${f.branch} WHERE id=${f.approverMember}`;
    for (const invalid of [false, true]) {
      const payload = invalid
        ? { expected_revision: -1 }
        : action === 'decide'
          ? approval
          : { expected_revision: 2, reason: 'Synthetic' };
      const hidden = await f.h.app.inject({
        method: 'POST',
        url: route(row.id, action),
        headers: headers(),
        payload,
      });
      const unknown = await f.h.app.inject({
        method: 'POST',
        url: route(leaveIds.newId(), action),
        headers: headers(),
        payload,
      });
      const unknownEmployee = await f.h.app.inject({
        method: 'POST',
        url: route(leaveIds.newId(), action, leaveIds.newId()),
        headers: headers(),
        payload,
      });
      expect(hidden.statusCode).toBe(invalid ? 400 : 404);
      expect(hidden.json()).toEqual(unknown.json());
      expect(hidden.json()).toEqual(unknownEmployee.json());
    }
    const owner = SYSTEM_ROLES.find((r) => r.code === 'owner');
    await f.h
      .owner`UPDATE memberships SET role_id=${owner?.id as string},scope_type='COMPANY',scope_id=${f.company} WHERE id=${f.approverMember}`;
  },
);
