import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeEvents,
  changeAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequestPage } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { asRole } from './attendance-exception.fixture.ts';
import { linkEmployee, seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import {
  createAttendanceChangeReadAccess,
  attendanceChangeAuthority as readAttendanceChangeAccess,
  attendanceChangeApprovers as readAttendanceChangeApprovers,
} from '../persistence/attendance-change-context.adapter.ts';
import { listAttendanceChangeRequests } from '../queries/attendance-change-requests.query.ts';

const permission = 'decide:attendance-change:company';
let f: ChangeFixture;
let ownerCookie: string;
let subjectId: string;
let delegatedEmployee: string;
let ownerEmployee: string;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  await asRole(f, 'general_manager');
  const role = SYSTEM_ROLES.find((r) => r.code === 'branch_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${role?.id as string},scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
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
  subjectId = await linkEmployee(f, null);
  delegatedEmployee = await linkEmployee(f, f.approverId);
  ownerEmployee = await linkEmployee(f, f.owner);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const headers = (cookie: string) => ({
  cookie,
  'x-company-id': f.company,
  'idempotency-key': leaveIds.newId(),
});
const route = () => `/v1/businesses/${f.business}/attendance-change-requests`;
const terms = (
  code = permission,
  scope: 'COMPANY' | 'BUSINESS' | 'BRANCH' = 'COMPANY',
  scopeId = f.company,
) => ({
  permission_code: code,
  effect: 'ALLOW',
  scope_type: scope,
  scope_id: scopeId,
  reason: 'Synthetic owner delegation',
  expires_at: null,
});
const grant = (membership = f.approverMember, payload = terms(), cookie = ownerCookie) =>
  f.h.app.inject({
    method: 'POST',
    url: `/v1/permissions/memberships/${membership}/overrides`,
    headers: headers(cookie),
    payload,
  });
const file = (employeeId = subjectId, userId = f.userId) =>
  f.fileChange.execute(changeActor(f, undefined, userId), {
    ...changeInput(f),
    employee_id: employeeId,
  });
const decide = (id: string, cookie = f.approverCookie, decision = 'APPROVED') =>
  f.h.app.inject({
    method: 'POST',
    url: `${route()}/${id}/decide`,
    headers: headers(cookie),
    payload: { decision, revision: 0, reason: 'Synthetic review' },
  });
const recipients = async (id: string) =>
  (await changeEvents(f, id))
    .filter((e) => e['event_type'] === 'AttendanceChangeRequested')
    .flatMap((e) =>
      (e['payload'].notification_recipients ?? []).map((r: { user_id: string }) => r.user_id),
    );
const page = async (userId = f.approverId) =>
  attendanceChangeRequestPage.parse(
    await f.db.withTenant(f.company, (tx) =>
      listAttendanceChangeRequests(
        tx,
        { companyId: f.company, businessId: f.business, userId },
        { limit: 100 },
        createAttendanceChangeReadAccess(f.clock),
      ),
    ),
  );

it('ACR-15 no permission has the identical missing-id envelope; owner grant is audited and effective', async () => {
  const request = await file();
  const denied = await decide(request.id);
  expect(denied.statusCode).toBe(404);
  expect(denied.json()).toEqual((await decide(leaveIds.newId())).json());
  const allowed = await grant();
  expect(allowed.statusCode).toBe(201);
  const audits = await f.h.owner`SELECT action FROM audit_log WHERE company_id=${f.company}
    AND entity='permission_override' AND entity_id=${allowed.json().id}`;
  expect(audits.map((r) => r['action'])).toContain('permission.granted');
  const waiting = await file();
  expect(await recipients(waiting.id)).toEqual([f.owner, f.approverId].sort());
  const result = await decide(waiting.id);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ status: 'APPROVED', decided_by: f.approverId });
  expect((await changeAudits(f, waiting.id)).map((r) => r['action'])).toEqual([
    'attendance_change.requested',
    'attendance_change.approved',
  ]);
});

it.each(['APPROVED', 'REJECTED'])(
  'ACR-15 delegated %s refuses both self cases and leaves requests unchanged',
  async (decision) => {
    const ownFiling = await file(subjectId, f.approverId);
    const ownAttendance = await file(delegatedEmployee);
    for (const row of [ownFiling, ownAttendance]) {
      expect(row.status).toBe('PENDING');
      expect(await recipients(row.id)).toEqual([f.owner]);
      const response = await decide(row.id, f.approverCookie, decision);
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('ATTENDANCE_CHANGE_SELF_FORBIDDEN');
      expect(await changeAudits(f, row.id)).toHaveLength(1);
      const [stored] = await f.h
        .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${row.id}`;
      expect(stored?.['status']).toBe('PENDING');
    }
  },
);

it('ACR-15 owner is a recipient and may decide her own attendance; the one-step path stays owner-only', async () => {
  const request = await file(ownerEmployee);
  expect(await recipients(request.id)).toEqual([f.owner, f.approverId].sort());
  expect((await page(f.owner)).items.find((r) => r.id === request.id)?.can_decide).toBe(true);
  const response = await decide(request.id, ownerCookie);
  expect(response.statusCode).toBe(200);
  expect(response.json().decided_by).toBe(f.owner);
  const direct = await file(ownerEmployee, f.owner);
  expect(direct.status).toBe('APPROVED');
  expect(await recipients(direct.id)).toEqual([]);
});

it('delegated inbox covers the business and can_decide respects requester, employee, state and branch DENY', async () => {
  const other = await file();
  const mine = await file(subjectId, f.approverId);
  const aboutMe = await file(delegatedEmployee);
  const done = await file();
  expect((await decide(done.id)).statusCode).toBe(200);
  const session_id = await seedSession(f, { employeeId: subjectId, branchId: f.secondBranch });
  const elsewhere = await f.fileChange.execute(changeActor(f), {
    ...changeInput(f),
    employee_id: subjectId,
    kind: 'VOID_SESSION',
    session_id,
  });
  const denial = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${denial},${f.approverMember},${permission},'DENY','BRANCH',${f.secondBranch},'Synthetic scoped denial',${f.owner})`;
  try {
    const rows = (await page()).items;
    expect(rows.find((r) => r.id === other.id)?.can_decide).toBe(true);
    expect(rows.find((r) => r.id === aboutMe.id)).toBeUndefined();
    for (const row of [mine, done, elsewhere])
      expect(rows.find((r) => r.id === row.id)?.can_decide).toBe(false);
    expect((await decide(elsewhere.id)).statusCode).toBe(404);
    expect(
      await f.db.withTenant(f.company, (tx) =>
        readAttendanceChangeApprovers(tx, f.company, f.business, f.secondBranch, f.clock.now()),
      ),
    ).toEqual([{ userId: f.owner, owner: true }]);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${denial}`;
  }
});

it('ACR-15 a non-owner editor cannot grant, deny or revoke the permission', async () => {
  const manager = SYSTEM_ROLES.find((r) => r.code === 'business_manager');
  await f.h
    .owner`UPDATE memberships SET role_id=${manager?.id as string},scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.approverMember}`;
  expect(
    (await grant(f.memberId, terms('manage:memberships:business', 'BUSINESS', f.business)))
      .statusCode,
  ).toBe(201);
  const saved = await grant(f.approverMember, terms(permission, 'BRANCH', f.branch));
  expect(saved.statusCode).toBe(201);
  for (const effect of ['ALLOW', 'DENY']) {
    const response = await f.h.app.inject({
      method: 'POST',
      url: `/v1/businesses/${f.business}/permissions/memberships/${f.approverMember}/overrides`,
      headers: headers(f.cookie),
      payload: { ...terms(permission, 'BRANCH', f.branch), effect },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('PERMISSION_OWNER_ONLY');
  }
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/permissions/memberships/${f.approverMember}/overrides/${saved.json().id}/revoke`,
    headers: headers(f.cookie),
    payload: { reason: 'Synthetic revoke' },
  });
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('PERMISSION_OWNER_ONLY');
  const revoked = await f.h.app.inject({
    method: 'POST',
    url: `/v1/permissions/memberships/${f.approverMember}/overrides/${saved.json().id}/revoke`,
    headers: headers(ownerCookie),
    payload: { reason: 'Synthetic owner revoke' },
  });
  expect(revoked.statusCode).toBe(200);
  const audit = await f.h.owner`SELECT action FROM audit_log WHERE company_id=${f.company}
    AND entity='permission_override' AND entity_id=${saved.json().id} ORDER BY id`;
  expect(audit.map((row) => row['action'])).toEqual(['permission.granted', 'permission.revoked']);
  await asRole(f, 'general_manager');
});

it('ACR-15 device ALLOW is refused on save and historical ALLOW is ignored for decisions and recipients', async () => {
  await asRole(f, 'device');
  try {
    const response = await grant(f.approverMember, terms(permission, 'BRANCH', f.secondBranch));
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('PERMISSION_ROLE_FORBIDDEN');
    await f.h
      .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${leaveIds.newId()},${f.approverMember},${permission},'ALLOW','BRANCH',${f.secondBranch},'Synthetic historical grant',${f.owner})`;
    const access = await f.db.withTenant(f.company, (tx) =>
      readAttendanceChangeAccess(tx, f.company, f.approverId, f.business, f.branch, f.clock.now()),
    );
    expect(access.canDecide).toBe(false);
    const row = await file();
    expect(await recipients(row.id)).not.toContain(f.approverId);
    expect((await decide(row.id)).statusCode).toBe(404);
  } finally {
    await asRole(f, 'general_manager');
  }
});

it('recipient resolution deduplicates memberships and ignores expired members and grants', async () => {
  const duplicate = leaveIds.newId();
  const gm = SYSTEM_ROLES.find((r) => r.code === 'general_manager');
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${f.company},${duplicate},${f.approverId},${gm?.id as string},'global','COMPANY',${f.company},'2026-01-01',NULL)`;
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${override},${duplicate},${permission},'ALLOW','COMPANY',${f.company},'Synthetic duplicate',${f.owner})`;
  const read = () =>
    f.db.withTenant(f.company, (tx) =>
      readAttendanceChangeApprovers(tx, f.company, f.business, f.branch, f.clock.now()),
    );
  expect((await read()).filter((a) => a.userId === f.approverId)).toHaveLength(1);
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-01' WHERE company_id=${f.company} AND id=${f.approverMember}`;
  await f.h
    .owner`UPDATE permission_overrides SET expires_at='2026-10-01' WHERE company_id=${f.company} AND id=${override}`;
  try {
    expect((await read()).some((a) => a.userId === f.approverId)).toBe(false);
  } finally {
    await f.h
      .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.approverMember}`;
  }
});
