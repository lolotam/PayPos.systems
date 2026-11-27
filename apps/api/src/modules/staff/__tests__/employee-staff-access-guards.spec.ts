import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { Controller, Get } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  addEmployee,
  cancelPending,
  grant,
  grantPath,
  nextPhone,
  staffAccessFixture,
  staffUsersOf,
  systemRoleId,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { canLinkEmployeeUser } from '../persistence/employee-context.adapter.ts';

// مسار اختباري تحت شجرة staff-access: يثبت إن البوابة تغطي كل مسارات الشريحة، مش المسارات الثلاثة بس.
@Controller('businesses/:businessId/employees/:employeeId/staff-access')
class TestStaffAccessSubRouteController {
  @Get('anything/else')
  @Authenticated()
  async probe(): Promise<{ reached: boolean }> {
    return { reached: true };
  }
}

// مسار شقيق بنفس الجذر: لازم يفضل بره البوابة، عشان توسيع النمط ما يقفلش مسار تاني.
@Controller('businesses/:businessId/employees/:employeeId')
class TestStaffAccessSiblingController {
  @Get('staff-access-sibling')
  @Authenticated()
  async sibling(): Promise<{ reached: boolean }> {
    return { reached: true };
  }
}

const TEST_ROUTE_CONTROLLERS = [
  TestStaffAccessSubRouteController,
  TestStaffAccessSiblingController,
];

const ids = systemUuidV7();
const ADMIN_ORIGIN = 'https://admin.example.test';
let f: Fixture;
let gated: Fixture;
let db: ReturnType<typeof createDatabase>;
beforeAll(async () => {
  f = await staffAccessFixture({
    staffAccessRoutes: true,
    controllers: TEST_ROUTE_CONTROLLERS,
  });
  gated = await staffAccessFixture({
    corsOrigins: [ADMIN_ORIGIN],
    controllers: TEST_ROUTE_CONTROLLERS,
  });
  db = createDatabase({ url: f.h.urls.app, ids });
});
afterAll(async () => {
  await db?.close();
  await f?.db.close();
  await f?.h.close();
  await gated?.db.close();
  await gated?.h.close();
});

it('AC-F1-7c with the gate off every new route answers 503 NOT_READY', async () => {
  const employee = await addEmployee(gated, 'Gated', gated.salmiya, 30);
  const post = await gated.h.send('POST', grantPath(gated, employee), {
    cookie: gated.ownerCookie,
    company: gated.company,
    body: { phone: nextPhone(gated), phone_confirmed: true, role: 'staff', pin: '1234' },
  });
  expect(post).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  const get = await readStateSafe(gated, employee);
  expect(get).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  const remove = await gated.h.send('DELETE', `${grantPath(gated, employee)}/pending`, {
    cookie: gated.ownerCookie,
    company: gated.company,
  });
  expect(remove).toMatchObject({ status: 503, body: { code: 'NOT_READY' } });
  expect(
    await gated.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${employee}`,
  ).toHaveLength(0);
});

async function readStateSafe(fixture: Fixture, employeeId: string) {
  return fixture.h.send('GET', grantPath(fixture, employeeId), {
    cookie: fixture.ownerCookie,
    company: fixture.company,
  });
}

it('AC-ACT-6 the gate covers every route under staff-access, not only the three F1 routes', async () => {
  const gatedEmployee = await addEmployee(gated, 'Gated sub route', gated.salmiya, 31);
  const gatedUrl = `/v1/businesses/${gated.business}/employees/${gatedEmployee}/staff-access/anything/else`;
  // البوابة مقفولة: الرد 503 NOT_READY قبل المصادقة — الطلب بلا كوكي أصلاً.
  const refused = await gated.h.app.inject({ method: 'GET', url: gatedUrl });
  expect(refused.statusCode).toBe(503);
  expect(refused.json()).toMatchObject({ code: 'NOT_READY' });
  // البوابة مفتوحة: نفس المسار يوصل للـ handler.
  const openEmployee = await addEmployee(f, 'Open sub route', f.salmiya, 34);
  const opened = await f.h.send(
    'GET',
    `/v1/businesses/${f.business}/employees/${openEmployee}/staff-access/anything/else`,
    { cookie: f.ownerCookie, company: f.company },
  );
  expect(opened).toMatchObject({ status: 200, body: { reached: true } });
});

it('AC-ACT-6 the widened gate leaves a sibling route outside the staff-access tree open', async () => {
  const employee = await addEmployee(gated, 'Sibling route', gated.salmiya, 32);
  const sibling = await gated.h.send(
    'GET',
    `/v1/businesses/${gated.business}/employees/${employee}/staff-access-sibling`,
    { cookie: gated.ownerCookie, company: gated.company },
  );
  expect(sibling).toMatchObject({ status: 200, body: { reached: true } });
});

it('AC-F1-7b the link availability rule answers false for a staff user and true for a normal member', async () => {
  const granted = await addEmployee(f, 'Availability probe', f.salmiya, 33);
  expect((await grant(f, granted, nextPhone(f))).status).toBe(200);
  const [record] = await f.h
    .owner`SELECT user_id FROM employee_staff_access WHERE employee_id = ${granted}`;
  const normalMember = ids.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${normalMember},'Normal member',${`member-${normalMember}@example.test`})`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${normalMember},'01920000-0000-7000-8000-00000000010b','global','BRANCH',${f.salmiya})`;
  await f.db.withTenant(f.company, async (tx) => {
    expect(await canLinkEmployeeUser(tx, f.company, record?.user_id as string)).toBe(false);
    expect(await canLinkEmployeeUser(tx, f.company, normalMember)).toBe(true);
    expect(await canLinkEmployeeUser(tx, f.company, ids.newId())).toBe(false);
  });
});

it('P1-7 the real HTTP update renames ACTIVE staff but refuses changing their user link', async () => {
  const employeeId = await addEmployee(f, 'Editable staff', f.salmiya, 40);
  expect((await grant(f, employeeId, nextPhone(f))).status).toBe(200);
  const [employee] = await f.h.owner`SELECT user_id,revision FROM employees WHERE id=${employeeId}`;
  const body = {
    primary_branch_id: f.salmiya,
    name_en: 'Renamed staff',
    name_ar: null,
    role_code: 'staff',
    hire_date: '2026-01-01',
    contract_end: null,
    user_id: employee?.user_id,
    expected_revision: employee?.revision,
    branch_ids: [f.salmiya],
    branch_effective_date: '2026-11-24',
  };
  const url = `/v1/businesses/${f.business}/employees/${employeeId}`;
  const renamed = await f.h.send('PATCH', url, { cookie: f.ownerCookie, company: f.company, body });
  expect(renamed).toMatchObject({
    status: 200,
    body: { name_en: 'Renamed staff', user_id: employee?.user_id },
  });
  const changed = await f.h.send('PATCH', url, {
    cookie: f.ownerCookie,
    company: f.company,
    body: { ...body, expected_revision: Number(employee?.revision) + 1, user_id: null },
  });
  expect(changed).toMatchObject({ status: 400, body: { code: 'EMPLOYEE_USER_LINK_UNAVAILABLE' } });
  const [persisted] = await f.h.owner`SELECT user_id,name_en FROM employees WHERE id=${employeeId}`;
  expect(persisted).toMatchObject({ name_en: 'Renamed staff', user_id: employee?.user_id });
});

it.each(['GET', 'POST', 'DELETE'] as const)(
  'P1-9 %s gate precedes auth, invalid ids and body validation',
  async (method) => {
    const url =
      '/v1/businesses/malformed/employees/malformed/staff-access' +
      (method === 'DELETE' ? '/pending' : '');
    const response = await gated.h.app.inject({
      method,
      url,
      ...(method === 'POST'
        ? { headers: { 'content-type': 'application/json' }, payload: '{broken' }
        : {}),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY' });
  },
);

it('P1-4 with the gate off a cross-origin preflight succeeds and the three routes answer 503 with CORS headers', async () => {
  const base = '/v1/businesses/malformed/employees/malformed/staff-access';
  const preflight = await gated.h.app.inject({
    method: 'OPTIONS',
    url: base,
    headers: {
      origin: ADMIN_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  expect(preflight.statusCode).toBeLessThan(300);
  expect(preflight.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
  for (const method of ['GET', 'POST', 'DELETE'] as const) {
    const response = await gated.h.app.inject({
      method,
      url: method === 'DELETE' ? `${base}/pending` : base,
      headers: { origin: ADMIN_ORIGIN, 'content-type': 'application/json' },
      ...(method === 'POST' ? { payload: '{broken' } : {}),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'NOT_READY' });
    expect(response.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  }
});

it('AC-ACT-11 a cancel without authority answers the same refusal with and without a pending record', async () => {
  const [owner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='staff-access-owner@example.test'`;
  const withRecord = await addEmployee(f, 'Unauthorized with record', f.hawalli, 41);
  const withoutRecord = await addEmployee(f, 'Unauthorized without record', f.hawalli, 42);
  // سجل انتظار قديم ومنح من المالك: الفارق بين الحالتين هو وجود السجل نفسه لا غير.
  await f.h.owner`INSERT INTO employee_staff_access
    (company_id,id,business_id,employee_id,operation_id,role_code,branch_id,state,granted_by,attempt_id,attempt_started_at,phone_hash)
    VALUES (${f.company},${ids.newId()},${f.business},${withRecord},${ids.newId()},'staff',${f.hawalli},'PENDING',
      ${owner?.id},${ids.newId()}, now() - interval '25 hours',${'a'.repeat(64)})`;
  // مدير السالمية بلا سلطان على فرع حولي: الرفض لازم يكون واحد في الحالتين.
  const refused = await cancelPending(f, withRecord, f.managerCookie);
  const refusedWithoutRecord = await cancelPending(f, withoutRecord, f.managerCookie);
  expect(refused).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
  expect(refusedWithoutRecord).toMatchObject({
    status: 403,
    body: { code: 'STAFF_ACCESS_NOT_ALLOWED' },
  });
  // الرفض ما بيلمسش السجل ولا بيكشف وجوده.
  expect(
    await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${withRecord}`,
  ).toHaveLength(1);
});

// GR-003: فرع مؤرشف ما بياخدش دخول — القايمة بتفرشه على السيرفر كمان.
it('080-b an archived extra branch is refused and writes nothing', async () => {
  const employee = await addEmployee(f, 'Archived branch', f.salmiya, 43);
  await f.h
    .owner`UPDATE branches SET is_active=false WHERE company_id=${f.company} AND id=${f.hawalli}`;
  try {
    const usersBefore = (await staffUsersOf(f)).length;
    const response = await grant(f, employee, nextPhone(f), f.ownerCookie, {
      additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
    });
    expect(response).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
    expect(
      await f.h.owner`SELECT id FROM employee_staff_access WHERE employee_id = ${employee}`,
    ).toHaveLength(0);
    expect((await staffUsersOf(f)).length).toBe(usersBefore);
  } finally {
    await f.h
      .owner`UPDATE branches SET is_active=true WHERE company_id=${f.company} AND id=${f.hawalli}`;
  }
});

// المانح لازم يكون عنده السلطة على كل فرع زيادة للموظفة، وإلا يقدر يوقف موظفة على فرع مش مسؤول عنه.
it('080-b a manager without authority on the extra branch cannot stop the access', async () => {
  const employee = await addEmployee(f, 'Guarded stop', f.salmiya, 44);
  await grant(f, employee, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  const [record] = await f.h
    .owner`SELECT user_id FROM employee_staff_access WHERE employee_id = ${employee}`;
  const response = await f.h.send('DELETE', grantPath(f, employee), {
    cookie: f.managerCookie,
    company: f.company,
  });
  expect(response).toMatchObject({ status: 403, body: { code: 'STAFF_ACCESS_NOT_ALLOWED' } });
  const memberships = await f.h.owner`SELECT ends_at FROM memberships
    WHERE company_id=${f.company} AND user_id=${record?.user_id}`;
  expect(memberships).toHaveLength(2);
  expect(memberships.every((row) => row['ends_at'] === null)).toBe(true);
});

// 080-b: قراءة حالة الدخول بتغطي فروع الموظفة كلها — مدير السالمية ما يقدرش يدير موظفة
// شغالة على حولي كمان، لحد ما السجل يقف وتتفضل فروعها القديمة مش شغالة.
it('080-b the manager cannot manage an employee who also works on a branch he does not control', async () => {
  const employee = await addEmployee(f, 'Multi branch manager', f.salmiya, 45);
  // المدير يقرأ موظفة على السالمية وحولّي: صلاحية إدارة الموظفين على النشاط، وصلاحية
  // «إعطاء الدخول» على السالمية بس (دور مدير الفرع).
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${f.managerUserId},${systemRoleId('business_manager')},'global',
      'BUSINESS',${f.business})`;
  expect(
    (
      await grant(f, employee, nextPhone(f), f.ownerCookie, {
        additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
      })
    ).status,
  ).toBe(200);
  const before = await f.h.send('GET', grantPath(f, employee), {
    cookie: f.managerCookie,
    company: f.company,
  });
  expect(before.status).toBe(200);
  expect(before.body).toMatchObject({ can_manage: false, can_cancel: false });
  // بعد إيقاف الدخول بالصلاحية الكاملة: موظفة على السالمية بس، فالمدير يرجّع يديرها.
  const stopped = await f.h.send('DELETE', grantPath(f, employee), {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expect(stopped.status).toBe(200);
  const after = await f.h.send('GET', grantPath(f, employee), {
    cookie: f.managerCookie,
    company: f.company,
  });
  expect(after.status).toBe(200);
  expect(after.body).toMatchObject({ state: 'STOPPED', can_manage: true });
});
