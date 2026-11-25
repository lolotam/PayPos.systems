import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import {
  addEmployee,
  hashStaffPin,
  grant,
  nextPhone,
  capturedLogs,
  readState,
  systemRoleId,
  staffAccessFixture,
  verifyStaffPin,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { createPersonalEligibility } from '../index.ts';
import {
  NEW_PIN,
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
it.each(['inside', 'outside'])(
  'P1-11 phone owned %s the company leaves that user PIN and sessions unchanged and logs no secrets',
  async (where) => {
    const phone = nextPhone(f);
    const userId = await phoneHolder(where, phone);
    const before = await holderState(userId);
    const employee = await addEmployee(
      f,
      'Refused ' + where,
      f.salmiya,
      where === 'inside' ? 401 : 402,
    );
    const pin = '8472';
    const response = await grant(f, employee, phone, f.ownerCookie, { pin });
    expect(response).toMatchObject({ status: 409, body: { code: 'STAFF_ACCESS_PHONE_TAKEN' } });
    expect(JSON.stringify(response.body)).not.toContain(userId);
    expect(await holderState(userId)).toEqual(before);
    expect(capturedLogs().includes(phone), 'Full phone is absent from logs').toBe(false);
    expect(capturedLogs().includes(pin), 'PIN is absent from logs').toBe(false);
  },
);

it.each(['inside', 'outside'])(
  'E1 a confirmed refusal for a number owned %s the company releases the attempt so the corrected number works at once',
  async (where) => {
    const taken = nextPhone(f);
    await phoneHolder(where, taken, '-release');
    const employee = await addEmployee(f, 'Released ' + where, f.salmiya, where === 'inside' ? 411 : 412);
    expect(await grant(f, employee, taken)).toMatchObject({
      status: 409,
      body: { code: 'STAFF_ACCESS_PHONE_TAKEN' },
    });
    expect(
      await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id=${employee}`,
    ).toHaveLength(0);
    const corrected = nextPhone(f);
    expect((await grant(f, employee, corrected)).status).toBe(200);
    expect(
      await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id=${employee}`,
    ).toMatchObject([{ state: 'ACTIVE' }]);
  },
);

const staffSessionsOf = (userId: string) => f.h.owner`SELECT id FROM session
  WHERE purpose IN ('STAFF_POS','STAFF_PERSONAL') AND user_id=${userId}`;

it('F3-1 changes the phone, ends both staff sessions and leaves one temporary PIN for the new phone', async () => {
  const staff = await h.activeStaff();
  const personal = await h.personalSession(staff.userId);
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(200);
  const before = await h.pinRow(staff.userId);
  const newPhone = nextPhone(f);

  const response = await h.changePhone(staff.employee, newPhone);
  expect(response).toMatchObject({
    status: 200,
    body: {
      state: 'ACTIVE',
      role: 'staff',
      branch_id: f.salmiya,
      phone_last3: newPhone.slice(-3),
      can_manage: true,
    },
  });
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: newPhone });
  expect((await h.phoneOf(staff.userId))?.phone_binding_approved_at).not.toBeNull();
  // الجلستان وصف نافذة العرض الخاصة بجلسة STAFF_PERSONAL اتمسحوا، والجلسة القديمة بقت مجهولة.
  expect(await staffSessionsOf(staff.userId)).toHaveLength(0);
  expect(
    await f.h.owner`SELECT id FROM verification WHERE identifier LIKE ${`%${personal}%`}`,
  ).toHaveLength(0);
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(401);

  const after = await h.pinRow(staff.userId);
  expect(after?.id).not.toBe(before?.id);
  expect(after?.temporary).toBe(true);
  expect(after?.set_by).toBe(await h.ownerUserId());
  expect(Number(after?.expires_at) - Number(after?.set_at)).toBe(24 * 60 * 60 * 1000);
  expect(await verifyStaffPin(NEW_PIN, after?.pin_hash as string)).toBe(true);
  expect(await h.recordOf(staff.employee)).toMatchObject({
    state: 'ACTIVE',
    phone_hash: h.phoneHash(newPhone),
  });
  // القديم: الهاتف القديم والرقم الدائم القديم مرفوضين، والمؤقت الجديد بيطلب تغييراً (F2).
  expect((await h.signIn(PERMANENT_PIN, staff.phone)).statusCode).toBe(401);
  expect((await h.signIn(PERMANENT_PIN, newPhone)).statusCode).toBe(401);
  expect((await h.signIn(NEW_PIN, newPhone)).json().code).toBe('PIN_CHANGE_REQUIRED');
});

it('F3-1 writes audit and one event without any phone or PIN in them', async () => {
  const staff = await h.activeStaff();
  const newPhone = nextPhone(f);
  expect((await h.changePhone(staff.employee, newPhone)).status).toBe(200);
  const record = await h.recordOf(staff.employee);
  const events = await f.h.owner`SELECT payload FROM outbox
    WHERE event_type='StaffPinSetByOther' AND aggregate_id=${staff.employee}`;
  expect(events).toHaveLength(1);
  const audits = await f.h.owner`SELECT action, before, after FROM audit_log
    WHERE (entity_id=${record?.id as string} OR entity_id=${staff.userId})
      AND action IN ('phone_change_started','phone_changed','staff.pin_cleared','staff.pin_set_temporary')`;
  const actions = audits.map((row) => String(row['action']));
  expect(actions).toEqual(
    expect.arrayContaining([
      'phone_change_started',
      'phone_changed',
      'staff.pin_cleared',
      'staff.pin_set_temporary',
    ]),
  );
  // التغيير كتب بداية وإتماماً واحداً بس (الرقم المؤقت الأول من المنح الأصلي).
  expect(actions.filter((action) => action === 'phone_changed')).toHaveLength(1);
  expect(actions.filter((action) => action === 'phone_change_started')).toHaveLength(1);
  const platform = await f.h.owner`SELECT action, details FROM platform_audit_log
    WHERE details->>'user_id'=${staff.userId} AND action IN ('phone.binding_approved','staff.phone_changed')`;
  expect(platform.map((row) => row['action'])).toEqual(
    expect.arrayContaining(['phone.binding_approved', 'staff.phone_changed']),
  );
  const written = JSON.stringify([events, audits, platform]);
  for (const secret of [newPhone, staff.phone, NEW_PIN, PERMANENT_PIN])
    expect(written.includes(secret), 'secret absent from audit and events').toBe(false);
  expect(capturedLogs().includes(newPhone), 'Full phone is absent from logs').toBe(false);
  expect(capturedLogs().includes(`"${NEW_PIN}"`), 'PIN is absent from logs').toBe(false);
});

it('F3-1 an interruption after step one blocks the old PIN, session and eligibility, and the repeat finishes', async () => {
  const staff = await h.activeStaff();
  const newPhone = nextPhone(f);
  const workspace = { companyId: f.company, businessId: f.business };
  const eligibility = createPersonalEligibility(f.db);
  expect(await eligibility.eligible(staff.userId, workspace)).toBe(true);
  await expect(
    h.useCase({ beforeAuthStep: true }).execute({
      companyId: f.company,
      userId: await h.ownerUserId(),
      businessId: f.business,
      employeeId: staff.employee,
      phone: newPhone,
      pin: NEW_PIN,
    }),
  ).rejects.toThrow('CRASH_BEFORE_AUTH_STEP');

  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'PHONE_CHANGING' });
  expect((await h.pinRow(staff.userId))?.pin_hash).toBe('pbkdf2-sha256$cleared');
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: staff.phone });
  expect((await h.signIn(PERMANENT_PIN, staff.phone)).statusCode).toBe(401);
  expect((await h.signIn('0000', staff.phone)).statusCode).toBe(401);
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(401);
  expect(await eligibility.eligible(staff.userId, workspace)).toBe(false);

  expect((await h.changePhone(staff.employee, newPhone)).status).toBe(200);
  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'ACTIVE' });
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: newPhone });
  expect(await eligibility.eligible(staff.userId, workspace)).toBe(true);
  expect((await h.signIn(NEW_PIN, newPhone)).json().code).toBe('PIN_CHANGE_REQUIRED');
});

it('F3-1 an interruption after step two completes cleanly on the repeat with one approval row', async () => {
  const staff = await h.activeStaff();
  const newPhone = nextPhone(f);
  await expect(
    h.useCase({ afterAuthStep: true }).execute({
      companyId: f.company,
      userId: await h.ownerUserId(),
      businessId: f.business,
      employeeId: staff.employee,
      phone: newPhone,
      pin: NEW_PIN,
    }),
  ).rejects.toThrow('CRASH_AFTER_AUTH_STEP');
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: newPhone });
  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'PHONE_CHANGING' });
  expect(await staffSessionsOf(staff.userId)).toHaveLength(0);

  expect((await h.changePhone(staff.employee, newPhone)).status).toBe(200);
  const record = await h.recordOf(staff.employee);
  expect(record).toMatchObject({ state: 'ACTIVE' });
  const approvals = await f.h.owner`SELECT id FROM platform_audit_log
    WHERE action='phone.binding_approved' AND details->>'attempt_id'=${record?.attempt_id as string}`;
  expect(approvals).toHaveLength(1);
  expect(
    await f.h.owner`SELECT id FROM outbox WHERE event_type='StaffPinSetByOther'
      AND aggregate_id=${staff.employee}`,
  ).toHaveLength(1);
  expect((await h.signIn(NEW_PIN, newPhone)).json().code).toBe('PIN_CHANGE_REQUIRED');
});

it.each(['inside', 'outside'])(
  'F3-1 a phone owned %s the company is refused with 409, leaves PHONE_CHANGING recoverable and leaves the other user untouched',
  async (where) => {
    const staff = await h.activeStaff();
    const taken = nextPhone(f);
    const holder = await phoneHolder(where, taken, '-change');
    const holderBefore = await holderState(holder);
    const response = await h.changePhone(staff.employee, taken);
    expect(response).toMatchObject({ status: 409, body: { code: 'STAFF_ACCESS_PHONE_TAKEN' } });
    expect(JSON.stringify(response.body)).not.toContain(holder);
    expect(await holderState(holder)).toEqual(holderBefore);
    expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: staff.phone });
    // الحالة المبلّغة تبقى PHONE_CHANGING فيقدر المانح يكمّل التغيير برقم متاح بعد إغلاق أو إعادة تحميل.
    expect((await readState(f, staff.employee)).body).toMatchObject({
      state: 'PHONE_CHANGING',
      can_manage: true,
    });
    const freePhone = nextPhone(f);
    expect(await h.changePhone(staff.employee, freePhone)).toMatchObject({
      status: 200,
      body: { state: 'ACTIVE', phone_last3: freePhone.slice(-3) },
    });
    expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: freePhone });
    expect(capturedLogs().includes(taken), 'Full phone is absent from logs').toBe(false);
  },
);

it('F3-1 concurrent phone changes with different numbers converge with matching auth phone and tenant hash', async () => {
  const staff = await h.activeStaff();
  const ownerId = await h.ownerUserId();
  const [phoneA, phoneB] = [nextPhone(f), nextPhone(f)];
  let count = 0;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const runPhone = (phone: string, pin: string) =>
    h
      .useCase({
        afterStepOne: async () => {
          if (++count === 2) reached();
          await gate;
        },
      })
      .execute({
        companyId: f.company,
        userId: ownerId,
        businessId: f.business,
        employeeId: staff.employee,
        phone,
        pin,
      });
  const first = runPhone(phoneA, '2468');
  const second = runPhone(phoneB, '1359');
  await entered;
  release();
  const outcomes = await Promise.allSettled([first, second]);
  expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winner = outcomes.find((o) => o.status === 'fulfilled')?.value;
  const winningPhone = winner?.phoneLast3 === phoneA.slice(-3) ? phoneA : phoneB;
  const winningPin = winningPhone === phoneA ? '2468' : '1359';
  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'ACTIVE', phone_hash: h.phoneHash(winningPhone) });
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: winningPhone });
  expect((await h.signIn(winningPin, winningPhone)).json().code).toBe('PIN_CHANGE_REQUIRED');
});

it('F3-1 the auth step refuses another company, another operation and a non-staff user, and changes nothing', async () => {
  const staff = await h.activeStaff();
  const [marker] = await f.h.owner`SELECT staff_access_operation_id AS operation FROM "user"
    WHERE id=${staff.userId}`;
  const base = {
    operationId: marker?.operation as string,
    companyId: f.company,
    userId: staff.userId,
    phone: nextPhone(f),
    actorUserId: await h.ownerUserId(),
    attemptId: ids.newId(),
    ids,
  };
  const plain = ids.newId();
  await f.h.owner`INSERT INTO "user"(id,name,email) VALUES (${plain},'Plain',${`plain-${plain}@example.test`})`;
  for (const refused of [
    { ...base, companyId: ids.newId() },
    { ...base, operationId: ids.newId() },
    { ...base, userId: plain },
  ])
    await expect(f.h.auth.staffUsers.changePhone(refused)).rejects.toThrow('STAFF_RECORD_NOT_PENDING');
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: staff.phone });
  expect(await h.sessionStatus(staff.cookie, PERMANENT_PIN)).toBe(200);
});

it('F3-1 the gate answers 503 NOT_READY before authentication while the capability is off', async () => {
  const response = await gated.h.app.inject({
    method: 'PUT',
    url: h.path(ids.newId()).replace(f.business, gated.business),
    payload: { phone: nextPhone(gated), phone_confirmed: true, pin: NEW_PIN },
  });
  expect(response.statusCode).toBe(503);
  expect(response.json().code).toBe('NOT_READY');
});

it('F3-1 the strict contract refuses an unconfirmed phone, a short PIN and extra fields', async () => {
  const staff = await h.activeStaff();
  const phone = nextPhone(f);
  for (const body of [{ phone_confirmed: false }, { pin: '123' }, { role: 'reception' }])
    expect((await h.changePhone(staff.employee, phone, f.ownerCookie, body)).status).toBe(400);
  expect(await h.phoneOf(staff.userId)).toMatchObject({ phone_number: staff.phone });
  expect(await h.recordOf(staff.employee)).toMatchObject({ state: 'ACTIVE' });
});

/** موظفة بدخول فعّال ثم تحويل سجلها لحالة بعينها — الرفض لازم يسبق أي كتابة. */
async function inState(state: 'STOPPED' | 'CANCELLING') {
  const staff = await h.activeStaff();
  await f.h.owner`UPDATE employee_staff_access SET state=${state}, membership_id=NULL
    WHERE employee_id=${staff.employee}`;
  return { employee: staff.employee, cookie: f.ownerCookie, userId: staff.userId };
}

it.each([
  ['the employee herself', async () => {
    const staff = await h.activeStaff();
    await f.h.owner`UPDATE employees SET user_id=${f.managerUserId} WHERE id=${staff.employee}`;
    return { employee: staff.employee, cookie: f.managerCookie, userId: staff.userId };
  }],
  ['a user who is not staff', async () => ({
    employee: await addEmployee(f, 'Plain', f.salmiya, 801),
    cookie: f.ownerCookie,
    userId: null,
  })],
  ['a STOPPED record', () => inState('STOPPED')],
  ['a CANCELLING record', () => inState('CANCELLING')],
  ['a manager of another branch', async () => {
    const staff = await h.activeStaff();
    await f.h.owner`UPDATE employees SET primary_branch_id=${f.hawalli} WHERE id=${staff.employee}`;
    return { employee: staff.employee, cookie: f.managerCookie, userId: staff.userId };
  }],
])('F3-1 refuses %s with 403 and writes nothing', async (_name, build) => {
  const target = await build();
  const before = target.userId === null ? null : JSON.stringify(await h.pinRow(target.userId));
  const refused = await h.changePhone(target.employee, nextPhone(f), target.cookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
  if (target.userId !== null) expect(JSON.stringify(await h.pinRow(target.userId))).toBe(before);
});

async function phoneHolder(where: string, phone: string, tag = ''): Promise<string> {
  const cookie = await f.h.signedInOperator(`phone-holder-${where}${tag}@example.test`);
  const holder = await f.h.auth.getSession(new Headers({ cookie }));
  if (holder === null) throw new Error('HOLDER_SESSION_MISSING');
  const userId = holder.userId;
  const company =
    where === 'inside' ? f.company : await f.h.onboard(cookie, 'Foreign phone employer');
  await f.h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=now() WHERE id=${userId}`;
  if (where === 'inside')
    await f.h
      .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${userId},${systemRoleId('accountant')},'global','COMPANY',${company})`;
  const hash = await hashStaffPin('9026');
  await f.h.owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_at,temporary)
    VALUES (${company},${ids.newId()},${userId},${hash},now(),false)`;
  expect(await f.h.owner`SELECT id FROM session WHERE user_id=${userId}`).not.toHaveLength(0);
  return userId;
}

async function holderState(userId: string) {
  const pins = await f.h.owner`SELECT * FROM cashier_pins WHERE user_id=${userId} ORDER BY id`;
  const sessions = await f.h.owner`SELECT * FROM session WHERE user_id=${userId} ORDER BY id`;
  const fingerprint = (rows: unknown) =>
    createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  return { pins: fingerprint(pins), sessions: fingerprint(sessions) };
}
