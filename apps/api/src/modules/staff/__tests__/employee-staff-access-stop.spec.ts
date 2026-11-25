import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
  capturedLogs,
  grant,
  staffAccessFixture,
  verifyStaffPin,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { createPersonalEligibility } from '../index.ts';
import {
  createStaffAccessSessionEnder,
  createStopEmployeeStaffAccessSteps,
} from '../persistence/staff-access-stop.adapter.ts';
import { StopEmployeeStaffAccessUseCase } from '../use-cases/stop-employee-staff-access/stop-employee-staff-access.ts';
import {
  GRANT_PIN,
  PERMANENT_PIN,
  phoneChangeHelpers,
} from './employee-staff-access-phone-change.fixture.ts';

const ids = systemUuidV7();
let f: Fixture;
let gated: Fixture;
let h: ReturnType<typeof phoneChangeHelpers>;

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true, staffOrigin: origin });
  gated = await staffAccessFixture();
  h = phoneChangeHelpers(f, await paired(f.h, f.ownerCookie, f.company, f.salmiya));
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
  await gated?.db.close();
  await gated?.h.close();
});

const pathOf = (employee: string) =>
  `/v1/businesses/${f.business}/employees/${employee}/staff-access`;
const stop = (employee: string, cookie = f.ownerCookie) =>
  f.h.send('DELETE', pathOf(employee), { cookie, company: f.company });
const staffSessionsOf = (userId: string) => f.h.owner`SELECT id FROM session
  WHERE purpose IN ('STAFF_POS','STAFF_PERSONAL') AND user_id=${userId}`;
const membershipsOf = (userId: string) => f.h.owner`SELECT id, ends_at, scope_id FROM memberships
  WHERE user_id=${userId} AND company_id=${f.company} ORDER BY id`;
const userOf = async (employee: string) =>
  ((await f.h.owner`SELECT user_id FROM employees WHERE id=${employee}`)[0]?.['user_id'] ??
    null) as string | null;

/** use case حقيقي على نفس القاعدة، بمنهي جلسات يفشل عند الطلب لتمثيل انقطاع بعد الالتزام. */
function useCase(sessionsFail: boolean): StopEmployeeStaffAccessUseCase {
  const real = createStaffAccessSessionEnder(f.h.auth.staffUsers);
  return new StopEmployeeStaffAccessUseCase(
    createStopEmployeeStaffAccessSteps(f.db),
    {
      deleteSessions: async (input) => {
        if (sessionsFail) throw new Error('CRASH_AFTER_COMMIT');
        await real.deleteSessions(input);
      },
    },
    { invalidate: async () => undefined },
    systemClock,
    ids,
  );
}

it('F3-2 stops access: membership ended, PIN cleared, both session kinds and private views gone, link kept', async () => {
  const staff = await h.activeStaff();
  const personal = await h.personalSession(staff.userId);
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(200);
  const [membership] = await membershipsOf(staff.userId);
  expect(membership?.['ends_at']).toBeNull();

  const response = await stop(staff.employee);
  expect(response).toMatchObject({
    status: 200,
    body: { state: 'STOPPED', role: 'staff', branch_id: f.salmiya, phone_last3: null, can_manage: true },
  });

  expect((await membershipsOf(staff.userId))[0]?.['ends_at']).not.toBeNull();
  expect(await h.recordOf(staff.employee)).toMatchObject({
    state: 'STOPPED',
    user_id: staff.userId,
    membership_id: null,
  });
  expect(await userOf(staff.employee)).toBe(staff.userId);
  const pin = await h.pinRow(staff.userId);
  expect(pin?.pin_hash).toBe('pbkdf2-sha256$cleared');
  expect(await verifyStaffPin(PERMANENT_PIN, pin?.pin_hash as string)).toBe(false);
  expect(await staffSessionsOf(staff.userId)).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM verification WHERE identifier LIKE ${`%${personal}%`}`,
  ).toHaveLength(0);
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(401);
  expect((await h.signIn(PERMANENT_PIN, staff.phone)).statusCode).toBe(401);
});

it('F3-2 a surviving staff session is refused on its next request even when the cleanup after the commit failed', async () => {
  const staff = await h.activeStaff();
  const eligibility = createPersonalEligibility(f.db);
  const workspace = { companyId: f.company, businessId: f.business };
  expect(await eligibility.eligible(staff.userId, workspace)).toBe(true);

  await useCase(true).execute({
    companyId: f.company,
    userId: await h.ownerUserId(),
    businessId: f.business,
    employeeId: staff.employee,
  });
  const survivor = await h.personalSession(staff.userId);
  expect(await staffSessionsOf(staff.userId)).not.toHaveLength(0);
  expect(survivor).toBeTruthy();

  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'STOPPED' });
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(401);
  expect(await eligibility.eligible(staff.userId, workspace)).toBe(false);
});

it('F3-2 a later grant reuses the same user, opens a new membership and sets a new temporary PIN', async () => {
  const staff = await h.activeStaff();
  expect((await stop(staff.employee)).status).toBe(200);
  const stoppedMembership = (await membershipsOf(staff.userId))[0]?.['id'];

  const again = await grant(f, staff.employee, staff.phone, f.ownerCookie, { pin: '8264' });
  expect(again).toMatchObject({ status: 200, body: { state: 'ACTIVE', role: 'staff' } });
  expect(await userOf(staff.employee)).toBe(staff.userId);
  const rows = await membershipsOf(staff.userId);
  expect(rows).toHaveLength(2);
  const fresh = rows.find((row) => row['id'] !== stoppedMembership);
  expect(fresh?.['ends_at']).toBeNull();
  expect(fresh?.['scope_id']).toBe(f.salmiya);
  expect(await h.recordOf(staff.employee)).toMatchObject({
    state: 'ACTIVE',
    user_id: staff.userId,
    membership_id: fresh?.['id'],
  });
  const pin = await h.pinRow(staff.userId);
  expect(pin?.temporary).toBe(true);
  expect(await verifyStaffPin('8264', pin?.pin_hash as string)).toBe(true);
  expect((await h.signIn('8264', staff.phone)).json().code).toBe('PIN_CHANGE_REQUIRED');
});

it('F3-2 writes membership, PIN and record audit rows with no phone or PIN in them', async () => {
  const staff = await h.activeStaff();
  expect((await stop(staff.employee)).status).toBe(200);
  const record = await h.recordOf(staff.employee);
  const membership = (await membershipsOf(staff.userId))[0]?.['id'] as string;
  const audits = await f.h.owner`SELECT action, entity, before, after FROM audit_log
    WHERE action IN ('staff.membership_ended','staff.pin_cleared','staff_access_stopped')
      AND entity_id IN (${membership}, ${staff.userId}, ${record?.id as string})`;
  const actions = audits.map((row) => String(row['action']));
  expect(actions.filter((action) => action === 'staff.membership_ended')).toHaveLength(1);
  expect(actions.filter((action) => action === 'staff.pin_cleared')).toHaveLength(1);
  expect(actions.filter((action) => action === 'staff_access_stopped')).toHaveLength(1);
  const ended = audits.find((row) => row['action'] === 'staff.membership_ended');
  expect(ended).toMatchObject({ entity: 'membership', before: { ends_at: null } });
  const written = JSON.stringify(audits);
  for (const secret of [staff.phone, GRANT_PIN, PERMANENT_PIN])
    expect(written.includes(secret), 'secret absent from audit').toBe(false);
  expect(capturedLogs().includes(staff.phone), 'Full phone is absent from logs').toBe(false);
});

it('F3-2 a repeated stop is refused and leaves the state unchanged', async () => {
  const staff = await h.activeStaff();
  expect((await stop(staff.employee)).status).toBe(200);
  const before = JSON.stringify(await membershipsOf(staff.userId));
  expect(await stop(staff.employee)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
  expect(JSON.stringify(await membershipsOf(staff.userId))).toBe(before);
});

it('F3-2 the gate answers 503 NOT_READY before authentication while the capability is off', async () => {
  const response = await gated.h.app.inject({
    method: 'DELETE',
    url: pathOf(ids.newId()).replace(f.business, gated.business),
  });
  expect(response.statusCode).toBe(503);
  expect(response.json().code).toBe('NOT_READY');
});

/** حالة السجل المطلوبة بدون موظفة دخول فعّال: كل حالة غير ACTIVE ترفض بلا أي كتابة. */
async function inState(state: 'PENDING' | 'CANCELLING' | 'PHONE_CHANGING') {
  const staff = await h.activeStaff();
  await f.h.owner`UPDATE employee_staff_access SET state=${state} WHERE employee_id=${staff.employee}`;
  return { employee: staff.employee, cookie: f.ownerCookie, userId: staff.userId };
}

it.each([
  ['the employee herself', async () => {
    const staff = await h.activeStaff();
    await f.h.owner`UPDATE employees SET user_id=${f.managerUserId} WHERE id=${staff.employee}`;
    return { employee: staff.employee, cookie: f.managerCookie, userId: staff.userId };
  }],
  ['an employee with no access record', async () => ({
    employee: await addEmployee(f, 'No access', f.salmiya, 901),
    cookie: f.ownerCookie,
    userId: null,
  })],
  ['a PENDING record', () => inState('PENDING')],
  ['a CANCELLING record', () => inState('CANCELLING')],
  ['a PHONE_CHANGING record', () => inState('PHONE_CHANGING')],
  ['a manager of another branch', async () => {
    const staff = await h.activeStaff();
    await f.h.owner`UPDATE employees SET primary_branch_id=${f.hawalli} WHERE id=${staff.employee}`;
    return { employee: staff.employee, cookie: f.managerCookie, userId: staff.userId };
  }],
])('F3-2 refuses %s with 403 and writes nothing', async (_name, build) => {
  const target = await build();
  const memberships =
    target.userId === null ? null : JSON.stringify(await membershipsOf(target.userId));
  const pin = target.userId === null ? null : JSON.stringify(await h.pinRow(target.userId));
  const refused = await stop(target.employee, target.cookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
  if (target.userId !== null) {
    expect(JSON.stringify(await membershipsOf(target.userId))).toBe(memberships);
    expect(JSON.stringify(await h.pinRow(target.userId))).toBe(pin);
  }
});

it('F3-2 answers 404 for a missing employee and for an employee of another company', async () => {
  expect(await stop(ids.newId())).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_NOT_FOUND' } });
  const staff = await h.activeStaff();
  const foreign = await f.h.signedInOperator('foreign-stop-owner@example.test');
  const foreignCompany = await f.h.onboard(foreign, 'Foreign stop employer');
  const response = await f.h.send('DELETE', pathOf(staff.employee), {
    cookie: foreign,
    company: foreignCompany,
  });
  expect(response.status).toBe(404);
  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'ACTIVE' });
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(200);
});

it('F3-2 the auth cleanup refuses another company, another operation and a non-staff user, and ends nothing', async () => {
  const staff = await h.activeStaff();
  const [marker] = await f.h.owner`SELECT staff_access_operation_id AS operation FROM "user"
    WHERE id=${staff.userId}`;
  const base = { operationId: marker?.operation as string, companyId: f.company, userId: staff.userId };
  const plain = ids.newId();
  await f.h.owner`INSERT INTO "user"(id,name,email) VALUES (${plain},'Plain',${`plain-${plain}@example.test`})`;
  for (const refused of [
    { ...base, companyId: ids.newId() },
    { ...base, operationId: ids.newId() },
    { ...base, userId: plain },
  ])
    await expect(f.h.auth.staffUsers.deleteSessions(refused)).rejects.toThrow('STAFF_RECORD_NOT_PENDING');
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(200);
  await f.h.auth.staffUsers.deleteSessions(base);
  expect(await staffSessionsOf(staff.userId)).toHaveLength(0);
});
