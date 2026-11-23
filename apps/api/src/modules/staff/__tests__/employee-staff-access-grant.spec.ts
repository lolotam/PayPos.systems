import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addEmployee,
  cancelPending,
  grant,
  grantPath,
  nextPhone,
  readState,
  recentErrorLogs,
  staffAccessFixture,
  staffUsersOf,
  type Fixture,
} from './employee-staff-access.fixture.ts';

const ids = systemUuidV7();
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
    await f.h.owner`SELECT id, pin_hash, temporary, expires_at, set_by FROM cashier_pins WHERE user_id = ${userId}`
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
  const users = await staffUsersOf(f);
  expect(users).toHaveLength(1);
  const user = users[0]!;
  expect(user.email).toMatch(/^staff-[0-9a-f-]{36}@staff\.pospay\.invalid$/);
  expect(user.email).not.toContain(phone);
  expect(user.phone_number).toBe(phone);
  expect(user.phone_binding_approved_at).not.toBeNull();
  const memberships = await f.h.owner`SELECT m.id, m.role_id, m.scope_type, m.scope_id, r.code
    FROM memberships m JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    WHERE m.company_id = ${f.company} AND m.user_id = ${user.id}`;
  expect(memberships).toHaveLength(1);
  expect(memberships[0]).toMatchObject({ code: 'staff', scope_type: 'BRANCH', scope_id: f.salmiya });
  const [employee] = await f.h.owner`SELECT user_id FROM employees WHERE id = ${sara}`;
  expect(employee?.user_id).toBe(user.id);
  const pin = await pinRow(user.id);
  expect(pin).toMatchObject({ temporary: true, set_by: expect.any(String) });
  expect(pin?.expires_at).not.toBeNull();
  const events = await f.h.owner`SELECT event_type FROM outbox WHERE event_type = 'StaffAccessGranted'`;
  expect(events).toHaveLength(1);
  const platformAudits = await f.h.owner`SELECT action, details FROM platform_audit_log
    WHERE details->>'user_id' = ${user.id} ORDER BY action`;
  expect(platformAudits.map((row) => row.action)).toEqual(['phone.binding_approved', 'staff.created']);
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
    expect(String(response.body?.code ?? '')).not.toBe('STAFF_ACCESS_ALREADY_GRANTED');
  }
  const roles = await f.h.owner`SELECT DISTINCT r.code FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.owner_key = m.role_owner_key
    JOIN employee_staff_access a ON a.company_id = m.company_id AND a.membership_id = m.id
    WHERE a.company_id = ${f.company}`;
  expect(roles.every((row) => row.code === 'staff' || row.code === 'cashier')).toBe(true);
});

it('AC-F1-5 a phone owned in another company is refused with no detail and no change there', async () => {
  const otherUser = ids.newId();
  const otherPhone = nextPhone(f);
  await f.h.owner`INSERT INTO "user"(id,name,email,phone_number)
    VALUES (${otherUser},'Other owner',${`other-${otherUser}@example.test`},${otherPhone})`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at = now() WHERE id = ${otherUser}`;
  const candidate = await addEmployee(f, 'Sameera', f.salmiya, 6);
  const response = await grant(f, candidate, otherPhone);
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'STAFF_ACCESS_PHONE_TAKEN' });
  expect(JSON.stringify(response.body)).not.toContain(otherUser);
  const unchanged = await f.h.owner`SELECT id, phone_number FROM "user" WHERE id = ${otherUser}`;
  expect(unchanged[0]?.phone_number).toBe(otherPhone);
  // الخطوة الثانية ترفض بعد إنشاء سجل الانتظار في الخطوة الأولى — السجل يبقى PENDING قابلاً للاستئناف
  // برقم حر، والموظفة تبقى بلا رابط ولا عضوية (FR-F1-6).
  const [pendingRecord] = await f.h.owner`SELECT state FROM employee_staff_access WHERE employee_id = ${candidate}`;
  expect(pendingRecord?.state).toBe('PENDING');
  const [stillUnlinked] = await f.h.owner`SELECT user_id FROM employees WHERE id = ${candidate}`;
  expect(stillUnlinked?.user_id).toBeNull();
  expect(await f.h.owner`SELECT id FROM memberships WHERE company_id = ${f.company} AND employee_id = ${candidate}`).toHaveLength(0);
  await f.h.owner`DELETE FROM "user" WHERE id = ${otherUser}`;
});

it('AC-F1-6 a crash after the record, after the user, and a refused repeat each resume to one state', async () => {
  const [ownerUser] = await f.h.owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  // (a) crash after step 1: a PENDING record the request does not know about.
  const mona = await addEmployee(f, 'Mona', f.salmiya, 7);
  const operationId = ids.newId();
  const beforeUsers = (await staffUsersOf(f)).length;
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO employee_staff_access
      (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by)
      VALUES (${f.company},${ids.newId()},${f.business},${mona},${operationId},'staff',${f.salmiya},'PENDING',
        ${ownerUser?.id})`),
  );
  const resumed = await grant(f, mona, nextPhone(f));
  expect(resumed.status).toBe(200);
  const [record] = await f.h.owner`SELECT operation_id, state FROM employee_staff_access WHERE employee_id = ${mona}`;
  expect(record?.operation_id).toBe(operationId);
  expect(record?.state).toBe('ACTIVE');
  expect((await staffUsersOf(f)).length).toBe(beforeUsers + 1);
  // (b) crash after step 2: the staff user exists and the record is still PENDING — the same request
  // finds the user by the operation id and completes with exactly one user, membership and link.
  const huda = await addEmployee(f, 'Huda', f.salmiya, 8);
  const hudaOperation = ids.newId();
  const hudaPhone = nextPhone(f);
  const orphanUser = ids.newId();
  await f.h.owner`INSERT INTO "user"(id,name,email,phone_number,staff_access_company_id,staff_access_operation_id,phone_binding_approved_at)
    VALUES (${orphanUser},'Huda staff',${`staff-${hudaOperation}@staff.pospay.invalid`},${hudaPhone},${f.company},${hudaOperation},now())`;
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO employee_staff_access
      (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by)
      VALUES (${f.company},${ids.newId()},${f.business},${huda},${hudaOperation},'staff',${f.salmiya},'PENDING',
        ${ownerUser?.id})`),
  );
  const resumedAfterUser = await grant(f, huda, hudaPhone);
  expect(resumedAfterUser.status).toBe(200);
  expect((await staffUsersOf(f)).filter((row) => row.email.includes(hudaOperation))).toHaveLength(1);
  const [linked] = await f.h.owner`SELECT user_id FROM employees WHERE id = ${huda}`;
  expect(linked?.user_id).toBe(orphanUser);
  expect(
    await f.h.owner`SELECT id FROM memberships WHERE company_id = ${f.company} AND user_id = ${orphanUser}`,
  ).toHaveLength(1);
  // (c) a refused candidate (own record) leaves nothing written and a repeat answers the same.
  const managerEmployee = await addEmployee(f, 'Manager herself', f.salmiya, 9);
  await f.h.owner`UPDATE employees SET user_id = ${f.managerUserId} WHERE id = ${managerEmployee}`;
  const refused = await grant(f, managerEmployee, nextPhone(f), f.managerCookie);
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect((await staffUsersOf(f)).length).toBe(beforeUsers + 2);
});

it('AC-F1-6 a repeat after success refuses with no writes: same record and no second event', async () => {
  const rana = await addEmployee(f, 'Rana repeat', f.salmiya, 10);
  const phone = nextPhone(f);
  expect((await grant(f, rana, phone)).status).toBe(200);
  const eventsBefore =
    await f.h.owner`SELECT count(*) AS n FROM outbox WHERE event_type = 'StaffAccessGranted'`;
  const recordBefore = await f.h.owner`SELECT id, operation_id, user_id, membership_id, state FROM employee_staff_access WHERE employee_id = ${rana}`;
  const repeat = await grant(f, rana, phone);
  expect(repeat.status).toBe(409);
  expect(repeat.body).toMatchObject({ code: 'STAFF_ACCESS_ALREADY_GRANTED' });
  expect(
    await f.h.owner`SELECT count(*) AS n FROM outbox WHERE event_type = 'StaffAccessGranted'`,
  ).toEqual(eventsBefore);
  expect(
    await f.h.owner`SELECT id, operation_id, user_id, membership_id, state FROM employee_staff_access WHERE employee_id = ${rana}`,
  ).toEqual(recordBefore);
});

it('AC-F1-6b two concurrent grants for one employee produce one access; one phone produces one access and one refusal', async () => {
  const dana = await addEmployee(f, 'Dana', f.salmiya, 12);
  const lina = await addEmployee(f, 'Lina', f.hawalli, 13);
  const phone = nextPhone(f);
  const [first, second] = await Promise.all([grant(f, dana, phone), grant(f, dana, phone)]);
  const statuses = [first.status, second.status];
  // السباق المتسلسل بالقفل يجيز الطلبين بنفس الحالة النهائية (الخاسر يقرأ ACTIVE ويرد بلا كتابة)،
  // أو يرفض الخاسر 409 لو وصل الخطوة الأولى بعد الالتزام — كلاهما سجل واحد وعضوية واحدة.
  expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
  expect(statuses).toContain(200);
  const refused = first.status === 409 ? first : second;
  if (refused.status === 409) {
    expect(['STAFF_ACCESS_ALREADY_GRANTED', 'STAFF_ACCESS_PHONE_TAKEN']).toContain(refused.body?.code);
  }
  expect(await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${dana}`).toHaveLength(1);
  expect(
    await f.h.owner`SELECT id FROM memberships WHERE company_id = ${f.company} AND employee_id IS NULL
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
  const zainActive = await f.h.owner`SELECT count(*) AS n FROM employee_staff_access WHERE employee_id = ${zain} AND state = 'ACTIVE'`;
  expect(Number(zainActive[0]?.n)).toBe(0);
});

it('AC-F1-8 RLS: another tenant reads zero rows and cannot write ours', async () => {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`SELECT id FROM employee_staff_access`),
  );
  expect(rows.length).toBeGreaterThan(0);
  const otherCookie = await f.h.signedInOperator('staff-access-foreign@example.test');
  const otherCompany = await f.h.onboard(otherCookie, 'Foreign employer');
  const foreign = await f.db.withTenant(otherCompany, (tx) =>
    tx.execute(sql`SELECT id FROM employee_staff_access`),
  );
  expect(foreign).toHaveLength(0);
  const [ownerUser] = await f.h.owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const foreignEmployee = await addEmployee(f, 'Foreign target', f.salmiya, 14);
  const write = f.db.withTenant(otherCompany, (tx) =>
    tx.execute(sql`INSERT INTO employee_staff_access
      (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by)
      VALUES (${f.company},${ids.newId()},${f.business},${foreignEmployee},${ids.newId()},'staff',${f.salmiya},'PENDING',
        ${ownerUser?.id})`),
  );
  await expect(write).rejects.toThrow();
});

it('AC-F1-9 the audit holds the four rows with the granter as actor and no PIN or phone', async () => {
  const [ownerUser] = await f.h.owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const hoda = await addEmployee(f, 'Hoda', f.salmiya, 15);
  const phone = nextPhone(f);
  expect((await grant(f, hoda, phone)).status).toBe(200);
  const [record] = await f.h.owner`SELECT id, user_id, membership_id FROM employee_staff_access WHERE employee_id = ${hoda}`;
  const rows = await f.h.owner`SELECT entity, action, actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company}
      AND (entity_id = ${hoda}
        OR entity_id = ${record?.id}
        OR entity_id = ${record?.membership_id}
        OR (entity = 'cashier_pin' AND entity_id = ${record?.user_id}))
    ORDER BY at`;
  const actions = rows.map((row) => `${row.entity}.${row.action}`);
  expect(actions).toContain('employee_staff_access.created');
  expect(actions).toContain('membership.created');
  expect(actions).toContain('employee.updated');
  expect(actions).toContain('cashier_pin.staff.pin_set_temporary');
  expect(rows.every((row) => row.actor_user_id === ownerUser?.id)).toBe(true);
  const [platform] = await f.h.owner`SELECT action, actor FROM platform_audit_log
    WHERE details->>'user_id' = ${record?.user_id} AND action = 'phone.binding_approved'`;
  expect(platform?.actor).toBe(ownerUser?.id);
  for (const row of [...rows, platform]) {
    expect(JSON.stringify(row)).not.toContain('1234');
    expect(JSON.stringify(row)).not.toContain(phone);
  }
});

it('FR-F1-1 the GET state covers NONE, PENDING and a foreign employee 404', async () => {
  const fresh = await addEmployee(f, 'Unlinked', f.salmiya, 20);
  const none = await readState(f, fresh);
  expect(none.body).toMatchObject({ state: 'NONE', can_manage: true, role: null, phone_last3: null });
  const foreign = await readState(f, ids.newId());
  expect(foreign.status).toBe(404);
  expect(foreign.body).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
  const [ownerUser] = await f.h.owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  await f.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,created_at)
    VALUES (${f.company},${ids.newId()},${f.business},${fresh},${ids.newId()},'reception',${f.salmiya},'PENDING',
      ${ownerUser?.id}, now() - interval '25 hours')`;
  const pendingState = await readState(f, fresh);
  expect(pendingState.body).toMatchObject({ state: 'PENDING', role: 'reception', can_manage: true });
  const cancelled = await cancelPending(f, fresh);
  if (cancelled.status !== 200) console.log('CANCEL BODY:', JSON.stringify(cancelled.body));
  expect(cancelled).toMatchObject({ status: 200, body: { state: 'NONE' } });
  expect(await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${fresh}`).toHaveLength(0);
});
