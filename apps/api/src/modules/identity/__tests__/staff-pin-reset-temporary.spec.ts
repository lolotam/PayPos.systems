import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { present } from '../../../../../../packages/db/test/present.ts';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { authPinHasher } from '../persistence/auth-pin-hasher.ts';

// AC-ACT-9: إعادة تعيين PIN على مستوى الشركة تتبع سياسة الرقم المؤقت.
// الموظفة اللي عندها سجل «إعطاء الدخول» ما بتاخدش من المدير رقم دائم؛
// والعضو العادي بياخد رقم دائم زي ما كان، حتى لو فيه رقم مؤقت متبقٍ من قبل.

const STAFF_PIN = '2468';
const MEMBER_PIN = '1357';
const LEFTOVER_PIN = '8642';
const STAFF_PHONE = '+99900000011';
const MEMBER_PHONE = '+99900000012';
const LEFTOVER_PHONE = '+99900000013';
const DAY_MS = 24 * 60 * 60 * 1000;

let h: Harness,
  manager: string,
  managerUserId: string,
  company: string,
  business: string,
  branch: string,
  device: Awaited<ReturnType<typeof paired>>,
  staffUserId: string,
  memberUserId: string,
  leftoverUserId: string;

const reset = (target: string, pin: string) =>
  h.send('POST', '/v1/staff-pins/reset', {
    cookie: manager,
    company,
    body: { user_id: target, pin },
  });

const signIn = (pin: string, number: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone: number, pin },
  });

const storedPin = async (userId: string) => {
  const [row] = await h.owner`SELECT temporary, expires_at, set_at, pin_hash FROM cashier_pins
    WHERE company_id=${company} AND user_id=${userId}`;
  return row ?? null;
};

const epochMs = (value: unknown): number =>
  new Date(value instanceof Date ? value.getTime() : String(value)).getTime();

const memberOf = async (email: string, number: string) => {
  const userId = await h.auth.provisionUser({
    email,
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${number} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  const membershipId = randomUUID();
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${membershipId},${userId},id,'global','BRANCH',${branch}
      FROM roles WHERE code='staff' AND company_id IS NULL`;
  return { userId, membershipId };
};

/** سجل «إعطاء الدخول» للموظفة: نفس أعمدة F1 وحالة ACTIVE — هو اللي بيجعل الرقم مؤقت. */
const staffAccessRecord = async (userId: string, membershipId: string): Promise<void> => {
  const employeeId = randomUUID();
  await h.owner`INSERT INTO employees
    (company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${employeeId},${business},${branch},${userId},'Reset temporary staff',
      'reset-temporary-staff','staff','2026-01-01',901)`;
  await h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,user_id,membership_id,role_code,branch_id,
      attempt_id,phone_hash,state,granted_by)
    VALUES(${company},${randomUUID()},${business},${employeeId},${randomUUID()},${userId},${membershipId},
      'staff',${branch},${randomUUID()},'synthetic-phone-hash','ACTIVE',${managerUserId})`;
};

beforeAll(async () => {
  h = await startHarness({ staffOrigin: origin });
  manager = await h.signedInOperator('reset-temporary-operator@synthetic.invalid');
  const [operator] = await h.owner`SELECT id FROM "user" WHERE email='reset-temporary-operator@synthetic.invalid'`;
  managerUserId = present(operator?.['id'] as string | undefined);
  company = await h.onboard(manager, 'Synthetic PIN reset temporary');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'reset-temporary-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'reset-temporary-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  const staff = await memberOf('reset-temporary-staff@synthetic.invalid', STAFF_PHONE);
  staffUserId = staff.userId;
  await staffAccessRecord(staff.userId, staff.membershipId);
  memberUserId = (await memberOf('reset-temporary-member@synthetic.invalid', MEMBER_PHONE)).userId;
  const leftover = await memberOf('reset-temporary-leftover@synthetic.invalid', LEFTOVER_PHONE);
  leftoverUserId = leftover.userId;
  // رقم مؤقت متبقٍ من منح دخل اتشال: السجل مش موجود، بس الصف لسه مؤقت.
  await h.owner`INSERT INTO cashier_pins
    (company_id,id,user_id,pin_hash,set_by,set_at,temporary,expires_at)
    VALUES(${company},${randomUUID()},${leftoverUserId},'pbkdf2-sha256$synthetic-leftover',
      ${managerUserId},clock_timestamp(),true,clock_timestamp()+interval '24 hours')`;
});
afterAll(async () => {
  await h?.close();
});

it('AC-ACT-9 a reset PIN for a staff-access user is temporary and refused at sign-in', async () => {
  expect((await reset(staffUserId, STAFF_PIN)).status).toBe(204);
  const row = present(await storedPin(staffUserId));
  expect(row['temporary']).toBe(true);
  // الانتهاء بعد 24 ساعة من لحظة الضبط نفسها (وقت السطر المحفوظ، مش ساعة الاختبار).
  expect(epochMs(row['expires_at']) - epochMs(row['set_at'])).toBe(DAY_MS);
  // الرقم المخزّن هو رقم المدير نفسه — الرفض في الدخول سببه أنه مؤقت، مش رقم غلط.
  expect(await authPinHasher.verify(STAFF_PIN, row['pin_hash'] as string)).toBe(true);
  const refused = await signIn(STAFF_PIN, STAFF_PHONE);
  expect(refused.statusCode).toBe(401);
  expect(refused.json().code).toBe('PIN_INVALID');
  const audited = await h.owner`SELECT action FROM audit_log WHERE company_id=${company}
    AND entity_id=${staffUserId} AND action='staff.pin_reset'`;
  expect(audited).toHaveLength(1);
});

it('AC-ACT-9 a reset PIN for an ordinary member stays permanent and signs in', async () => {
  expect((await reset(memberUserId, MEMBER_PIN)).status).toBe(204);
  const row = present(await storedPin(memberUserId));
  expect(row['temporary']).toBe(false);
  expect(row['expires_at']).toBeNull();
  const signedIn = await signIn(MEMBER_PIN, MEMBER_PHONE);
  expect(signedIn.statusCode).toBe(200);
  expect(signedIn.json().user_id).toBe(memberUserId);
});

it('AC-ACT-9 a reset clears a leftover temporary flag for an ordinary member', async () => {
  expect((await reset(leftoverUserId, LEFTOVER_PIN)).status).toBe(204);
  const row = present(await storedPin(leftoverUserId));
  expect(row['temporary']).toBe(false);
  expect(row['expires_at']).toBeNull();
});
