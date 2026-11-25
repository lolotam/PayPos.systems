import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  systemRoleId,
  verifyStaffPin,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

const ids = systemUuidV7();
/** الرقم السري الجديد — مختلف عن رقم المنح ('1234') عشان الفرق في البصمة يبان. */
const NEW_PIN = '4321';
const GRANT_PIN = '1234';
const PIN_TTL_MS = 24 * 60 * 60 * 1000;

let f: Fixture;
let gated: Fixture;

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
  gated = await staffAccessFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
  await gated?.db.close();
  await gated?.h.close();
});

/** مسار إعادة الضبط تحت شجرة staff-access — نفس شجرة البوابة. */
const pinPath = (fixture: Fixture, employeeId: string) =>
  `/v1/businesses/${fixture.business}/employees/${employeeId}/staff-access/pin`;

const resetPin = (
  fixture: Fixture,
  employeeId: string,
  cookie = fixture.ownerCookie,
  body: Record<string, unknown> = {},
) =>
  fixture.h.send('POST', pinPath(fixture, employeeId), {
    cookie,
    company: fixture.company,
    body: { pin: NEW_PIN, ...body },
  });

/** صف الرقم السري المخزّن — البصمة والعمر ومن ضبطه. */
const pinRow = async (fixture: Fixture, userId: string) =>
  (
    await fixture.h.owner`SELECT id, pin_hash, temporary, expires_at, set_by, set_at
      FROM cashier_pins WHERE user_id = ${userId}`
  )[0];

/** مستخدم عادي بلا دخول موظفة — حساب memberships مش لازم له. */
async function plainUser(fixture: Fixture, name: string): Promise<string> {
  const userId = ids.newId();
  await fixture.h.owner`INSERT INTO "user"(id,name,email)
    VALUES (${userId},${name},${`${name.toLowerCase().replaceAll(' ', '-')}-${userId}@example.test`})`;
  return userId;
}

/**
 * سجل دخول بحالة معيّنة لموظفة: سجل ACTIVE لازم يكون له عضوية (قيد قاعدة البيانات)،
 * والباقي بيشتغل ببلا عضوية.
 */
async function accessRecord(
  fixture: Fixture,
  employeeId: string,
  userId: string,
  state: 'ACTIVE' | 'PENDING' | 'STOPPED',
  branchId: string,
): Promise<void> {
  const membershipId = ids.newId();
  await fixture.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${fixture.company},${membershipId},${userId},${systemRoleId('staff')},'global','BRANCH',${branchId})`;
  const [owner] = await fixture.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  await fixture.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,user_id,
      membership_id,attempt_id,attempt_started_at,phone_hash)
    VALUES (${fixture.company},${ids.newId()},${fixture.business},${employeeId},${ids.newId()},'staff',${branchId},
      ${state},${owner?.id},${userId},${state === 'ACTIVE' ? membershipId : null},${ids.newId()},now(),
      ${'a'.repeat(64)})`;
}

it('F2b-1 the branch manager resets the PIN of her own branch ACTIVE employee', async () => {
  const sara = await addEmployee(f, 'Sara reset', f.salmiya, 101);
  expect((await grant(f, sara, nextPhone(f))).status).toBe(200);
  const [record] = await f.h.owner`SELECT user_id FROM employee_staff_access WHERE employee_id = ${sara}`;
  const userId = record?.user_id as string;
  const before = await pinRow(f, userId);

  const response = await resetPin(f, sara, f.managerCookie);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    state: 'ACTIVE',
    role: 'staff',
    branch_id: f.salmiya,
    can_manage: true,
    can_cancel: false,
  });

  const after = await pinRow(f, userId);
  expect(after?.temporary).toBe(true);
  expect(after?.set_by).toBe(f.managerUserId);
  expect(Number(after?.expires_at) - Number(after?.set_at)).toBe(PIN_TTL_MS);
  // الرقم الجديد هو اللي بيتحقّق، والقديم مبقاش.
  expect(await verifyStaffPin(NEW_PIN, after?.pin_hash as string)).toBe(true);
  expect(await verifyStaffPin(GRANT_PIN, after?.pin_hash as string)).toBe(false);
  // المعرّف اتقلب: أي proof تغيير رقم سابق بقى منتهي من غير لمس جدول الـ proofs.
  expect(after?.id).not.toBe(before?.id);

  // ربط الموظفة بالمستخدم ما اتغيّرش.
  const [employee] = await f.h.owner`SELECT user_id FROM employees WHERE id = ${sara}`;
  expect(employee?.user_id).toBe(userId);

  // الحدث: معرّفات بس — مفيش رقم سري ولا hash في الحمولة.
  const events = await f.h.owner`SELECT aggregate_type, aggregate_id, event_type, payload FROM outbox
    WHERE event_type = 'StaffPinSetByOther' AND aggregate_id = ${sara}`;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    aggregate_type: 'employee',
    aggregate_id: sara,
    event_type: 'StaffPinSetByOther',
  });
  expect(events[0]?.payload).toEqual({
    employee_id: sara,
    user_id: userId,
    branch_id: f.salmiya,
  });

  // التدقيق: الفاعل هو المانح، والصف مفيهوش رقم سري ولا hash.
  const audits = await f.h.owner`SELECT entity, entity_id, action, actor_user_id, before, after FROM audit_log
    WHERE entity = 'cashier_pin' AND entity_id = ${userId} AND action = 'staff.pin_reset_temporary'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.actor_user_id).toBe(f.managerUserId);
  expect(audits[0]?.before).toBeNull();
  expect(audits[0]?.after).toEqual({ set_by: f.managerUserId, temporary: true });
});

it('F2b-2 the reset is refused for an employee of another branch', async () => {
  const hawalli = await addEmployee(f, 'Hala reset', f.hawalli, 102);
  expect((await grant(f, hawalli, nextPhone(f))).status).toBe(200);
  const refused = await resetPin(f, hawalli, f.managerCookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
});

it('F2b-3 the reset is refused for the employee herself', async () => {
  // المدير نفسه موظفة في الشركة: إعادة ضبط رقمها من نفسها مرفوضة.
  const self = await addEmployee(f, 'Manager herself', f.salmiya, 103);
  await f.h.owner`UPDATE employees SET user_id = ${f.managerUserId} WHERE id = ${self}`;
  await accessRecord(f, self, f.managerUserId, 'ACTIVE', f.salmiya);
  const refused = await resetPin(f, self, f.managerCookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
});

it('F2b-4 the reset is refused for a user who is not staff', async () => {
  const plain = await addEmployee(f, 'Plain member', f.salmiya, 104);
  const memberId = await plainUser(f, 'Plain member');
  await f.h.owner`UPDATE employees SET user_id = ${memberId} WHERE id = ${plain}`;
  const refused = await resetPin(f, plain, f.managerCookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });

  // موظفة بلا ربط وبلا سجل دخول: مفيش حساب دخول أصلاً.
  const unlinked = await addEmployee(f, 'Unlinked', f.salmiya, 105);
  expect(await resetPin(f, unlinked, f.managerCookie)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
});

it('F2b-5 the reset is refused unless the access record is ACTIVE', async () => {
  const pending = await addEmployee(f, 'Pending staff', f.salmiya, 106);
  const pendingUser = await plainUser(f, 'Pending staff');
  await f.h.owner`UPDATE employees SET user_id = ${pendingUser} WHERE id = ${pending}`;
  await accessRecord(f, pending, pendingUser, 'PENDING', f.salmiya);
  expect(await resetPin(f, pending, f.managerCookie)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });

  const stopped = await addEmployee(f, 'Stopped staff', f.salmiya, 107);
  const stoppedUser = await plainUser(f, 'Stopped staff');
  await f.h.owner`UPDATE employees SET user_id = ${stoppedUser} WHERE id = ${stopped}`;
  await accessRecord(f, stopped, stoppedUser, 'STOPPED', f.salmiya);
  expect(await resetPin(f, stopped, f.managerCookie)).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
});

it('F2b-6 the strict schema refuses a PIN that is not exactly four digits', async () => {
  const sara = await addEmployee(f, 'Sara strict', f.salmiya, 108);
  for (const pin of ['123', '12345', 'abcd', '']) {
    const refused = await resetPin(f, sara, f.managerCookie, { pin });
    expect([400, 422]).toContain(refused.status);
  }
});

it('F2b-7 with the gate off the reset answers 503 NOT_READY before auth', async () => {
  const employee = await addEmployee(gated, 'Gated reset', gated.salmiya, 109);
  // الطلب بلا كوكي أصلاً: الرد 503 من البوابة مش 401 من المصادقة.
  const refused = await gated.h.app.inject({
    method: 'POST',
    url: pinPath(gated, employee),
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ pin: NEW_PIN }),
  });
  expect(refused.statusCode).toBe(503);
  expect(refused.json()).toMatchObject({ code: 'NOT_READY' });
});
