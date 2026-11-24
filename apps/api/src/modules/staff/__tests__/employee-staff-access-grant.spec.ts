import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addEmployee,
  grant,
  nextPhone,
  readState,
  staffAccessFixture,
  staffUsersOf,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

let f: Fixture;
beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const pinRow = async (userId: string) =>
  (
    await f.h
      .owner`SELECT id, pin_hash, temporary, expires_at, set_by FROM cashier_pins WHERE user_id = ${userId}`
  )[0];

it('AC-F1-1 the owner grant creates user, binding, membership, link, temporary PIN, audits and one event', async () => {
  const sara = await addEmployee(f, 'Sara', f.salmiya, 1);
  const phone = nextPhone(f);
  const response = await grant(f, sara, phone);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    state: 'ACTIVE',
    role: 'staff',
    branch_id: f.salmiya,
    phone_last3: phone.slice(-3),
    can_manage: false,
  });
  const [access] = await f.h.owner`SELECT operation_id FROM employee_staff_access WHERE employee_id=${sara}`;
  const users = (await staffUsersOf(f)).filter((u) => u.staff_access_operation_id === access?.operation_id);
  expect(users).toHaveLength(1);
  const user = users[0];
  if (user === undefined) throw new Error('the granted staff user is missing');
  expect(user.email).toMatch(/^staff-[0-9a-f-]{36}@staff\.pospay\.invalid$/);
  expect(user.email).not.toContain(phone);
  expect(user.phone_number).toBe(phone);
  expect(user.phone_binding_approved_at).not.toBeNull();
  const memberships = await f.h.owner`SELECT m.id, m.role_id, m.scope_type, m.scope_id, r.code
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${f.company} AND m.user_id = ${user.id}`;
  expect(memberships).toHaveLength(1);
  expect(memberships[0]).toMatchObject({
    code: 'staff',
    scope_type: 'BRANCH',
    scope_id: f.salmiya,
  });
  const [employee] = await f.h.owner`SELECT user_id FROM employees WHERE id = ${sara}`;
  expect(employee?.user_id).toBe(user.id);
  const pin = await pinRow(user.id);
  expect(pin).toMatchObject({ temporary: true, set_by: expect.any(String) });
  expect(pin?.expires_at).not.toBeNull();
  const events = await f.h
    .owner`SELECT event_type FROM outbox WHERE event_type = 'StaffAccessGranted' AND aggregate_id=${sara}`;
  expect(events).toHaveLength(1);
  const platformAudits = await f.h.owner`SELECT action, details FROM platform_audit_log
    WHERE details->>'user_id' = ${user.id} ORDER BY action`;
  expect(platformAudits.map((row) => row.action)).toEqual([
    'phone.binding_approved',
    'staff.created',
  ]);
  // BR-4: لا رقم سري ولا هاتف كامل في أي صف تدقيق.
  for (const row of platformAudits) {
    expect(JSON.stringify(row)).not.toContain('1234');
    expect(JSON.stringify(row)).not.toContain(phone);
  }
  expect(await readState(f, sara)).toMatchObject({ status: 200, body: { state: 'ACTIVE' } });
});

it('AC-F1-2 the reception choice produces a cashier membership whose role carries attendance', async () => {
  const nora = await addEmployee(f, 'Nora', f.hawalli, 2);
  const response = await grant(f, nora, nextPhone(f), f.ownerCookie, { role: 'reception' });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ role: 'reception' });
  const [membership] = await f.h.owner`SELECT m.role_id, r.code FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    JOIN employee_staff_access a ON a.company_id = m.company_id AND a.membership_id = m.id
    WHERE a.company_id = ${f.company} AND a.employee_id = ${nora}`;
  expect(membership?.code).toBe('cashier');
  const codes = await f.h.owner`SELECT permission_code FROM role_permissions
    WHERE role_id = ${membership?.role_id} AND permission_code IN
      ('clock:attendance:branch','create:customers:branch','login:staff:branch')`;
  expect(codes.map((row) => row.permission_code).sort()).toEqual([
    'clock:attendance:branch',
    'create:customers:branch',
    'login:staff:branch',
  ]);
});

it('AC-F1-3 the branch manager grants for her branch and is refused for another with no user created', async () => {
  const before = (await staffUsersOf(f)).length;
  const salmiyaEmployee = await addEmployee(f, 'Rana', f.salmiya, 3);
  const allowed = await grant(f, salmiyaEmployee, nextPhone(f), f.managerCookie);
  expect(allowed.status).toBe(200);
  const hawalliEmployee = await addEmployee(f, 'Hala', f.hawalli, 4);
  const refused = await grant(f, hawalliEmployee, nextPhone(f), f.managerCookie);
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect((await staffUsersOf(f)).length).toBe(before + 1);
});

it('AC-F1-4 the strict schema refuses foreign roles, scopes and branch ids with a 400', async () => {
  const candidate = await addEmployee(f, 'Dalia', f.salmiya, 5);
  const cases: Record<string, unknown>[] = [
    { role: 'manager' },
    { role: 'owner' },
    { scope: 'BRANCH' },
    { branch_id: f.hawalli },
    { phone_confirmed: false },
    { pin: '12345' },
  ];
  for (const extra of cases) {
    const response = await grant(f, candidate, nextPhone(f), f.ownerCookie, extra);
    expect([400, 422]).toContain(response.status);
    expect(String((response.body as { code?: string })?.code ?? '')).not.toBe(
      'STAFF_ACCESS_ALREADY_GRANTED',
    );
  }
  const roles = await f.h.owner`SELECT DISTINCT r.code FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    JOIN employee_staff_access a ON a.company_id = m.company_id AND a.membership_id = m.id
    WHERE a.company_id = ${f.company}`;
  expect(roles.every((row) => row.code === 'staff' || row.code === 'cashier')).toBe(true);
});

it('AC-F1-6 a repeat after success refuses with no writes: same record and no second event', async () => {
  const rana = await addEmployee(f, 'Rana repeat', f.salmiya, 10);
  const phone = nextPhone(f);
  expect((await grant(f, rana, phone)).status).toBe(200);
  const eventsBefore = await f.h
    .owner`SELECT count(*) AS n FROM outbox WHERE event_type = 'StaffAccessGranted'`;
  const recordBefore = await f.h
    .owner`SELECT id, operation_id, user_id, membership_id, state FROM employee_staff_access WHERE employee_id = ${rana}`;
  const pinBefore = await pinRow(recordBefore[0]?.user_id);
  const repeat = await grant(f, rana, phone);
  expect(await pinRow(recordBefore[0]?.user_id)).toEqual(pinBefore);
  expect(repeat.status).toBe(409);
  expect(repeat.body).toMatchObject({ code: 'STAFF_ACCESS_ALREADY_GRANTED' });
  expect(
    await f.h.owner`SELECT count(*) AS n FROM outbox WHERE event_type = 'StaffAccessGranted'`,
  ).toEqual(eventsBefore);
  expect(
    await f.h
      .owner`SELECT id, operation_id, user_id, membership_id, state FROM employee_staff_access WHERE employee_id = ${rana}`,
  ).toEqual(recordBefore);
});

it('AC-F1-6b two concurrent grants for one employee produce one access; one phone produces one access and one refusal', async () => {
  const dana = await addEmployee(f, 'Dana', f.salmiya, 12);
  const phone = nextPhone(f);
  const [first, second] = await Promise.all([grant(f, dana, phone), grant(f, dana, phone)]);
  const statuses = [first.status, second.status];
  // السباق المتسلسل بالقفل يجيز الطلبين بنفس الحالة النهائية (الخاسر يقرأ ACTIVE ويرد بلا كتابة)،
  // أو يرفض الخاسر 409 لو وصل الخطوة الأولى بعد الالتزام — كلاهما سجل واحد وعضوية واحدة.
  expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
  expect(statuses).toContain(200);
  const refused = first.status === 409 ? first : second;
  if (refused.status === 409) {
    expect(['STAFF_ACCESS_ALREADY_GRANTED']).toContain((refused.body as { code?: string })?.code);
  }
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${dana}`,
  ).toHaveLength(1);
  expect(
    await f.h
      .owner`SELECT id FROM memberships WHERE company_id = ${f.company} AND employee_id IS NULL
      AND user_id = (SELECT user_id FROM employee_staff_access WHERE employee_id = ${dana})`,
  ).toHaveLength(1);
  const otherPhone = nextPhone(f);
  const maya = await addEmployee(f, 'Maya', f.salmiya, 16);
  const zain = await addEmployee(f, 'Zain', f.hawalli, 17);
  const [samePhoneOne, samePhoneTwo] = await Promise.all([
    grant(f, maya, otherPhone),
    grant(f, zain, otherPhone),
  ]);
  expect([samePhoneOne.status, samePhoneTwo.status]).toContain(200);
  const phoneRefused = samePhoneOne.status === 409 ? samePhoneOne : samePhoneTwo;
  expect(phoneRefused.status).toBe(409);
  expect(phoneRefused.body).toMatchObject({ code: 'STAFF_ACCESS_PHONE_TAKEN' });
  const loser = samePhoneOne.status === 409 ? maya : zain;
  const winner = samePhoneOne.status === 409 ? zain : maya;
  const winnerActive = await f.h
    .owner`SELECT count(*) AS n FROM employee_staff_access WHERE employee_id = ${winner} AND state = 'ACTIVE'`;
  expect(Number(winnerActive[0]?.n)).toBe(1);
  const loserActive = await f.h
    .owner`SELECT count(*) AS n FROM employee_staff_access WHERE employee_id = ${loser} AND state = 'ACTIVE'`;
  expect(Number(loserActive[0]?.n)).toBe(0);
});
