import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Controller, Get, SetMetadata } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { employeeNameMatchKey } from '@pospay/domain';
import { PRIVATE_VIEW_WINDOW_HEADER } from '@pospay/contracts';
import { createLogger } from '@pospay/observability';
import { present } from '../../../../../../packages/db/test/present.ts';
import { origin, paired, phone } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { API_LOG_EVENTS } from '../../../shared/log-events.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { PrivateViewRoute } from '../../../shared/private-view.guard.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';
import { PrivateViewController } from '../http/private-view.controller.ts';

const personalOrigin = 'http://localhost:5173';
const ownPin = '1234';
const otherPhone = '+99900000002';

// مسار اختباري مثبّت مع التطبيق: يثبت إن المسار المحمي بيعمل فحص النافذة بعد جلسة الموظف بس.
@Controller('test/private-own')
class TestPrivateOwnController {
  @Get()
  @Authenticated()
  @SetMetadata(STAFF_ROUTE, 'staff')
  @SetMetadata(PERSONAL_ROUTE, 'staff')
  @PrivateViewRoute()
  async own(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

let h: Harness,
  manager: string,
  company: string,
  business: string,
  branch: string,
  device: Awaited<ReturnType<typeof paired>>,
  userId: string,
  staffCookie: string,
  employeeId: string;
const lines: string[] = [];
const sink = new Writable({
  write(chunk, _encoding, done) {
    lines.push(String(chunk));
    done();
  },
});

const staffHeaders = (extra: Record<string, string> = {}) => ({
  authorization: `Device ${device.token}`,
  origin,
  ...extra,
});
const openWindow = (pin: string, cookie = staffCookie) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: staffHeaders({ cookie }),
    payload: { pin },
  });
const ownRoute = (headers: Record<string, string>) =>
  h.app.inject({ method: 'GET', url: '/v1/test/private-own', headers });
const privateRoute = (windowId: string | null, cookie = staffCookie) =>
  ownRoute(
    staffHeaders({
      cookie,
      ...(windowId === null ? {} : { [PRIVATE_VIEW_WINDOW_HEADER]: windowId }),
    }),
  );
// الخطأ ما بيحملش حاجة غير الكود والرسالة، فده بيثبت إن مفيش بيانات خاصة في الرد.
const envelopeOnly = (body: Record<string, unknown>) =>
  expect(Object.keys(body).sort()).toEqual(['code', 'message_ar', 'message_en']);
const countOpenings = async (): Promise<number> => {
  const rows = await h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${company} AND action='staff.private_view_opened'`;
  return Number(rows[0]?.['n'] ?? 0);
};

beforeAll(async () => {
  h = await startHarness({
    staffOrigin: origin,
    personalOrigin,
    controllers: [TestPrivateOwnController],
    logs: sink,
  });
  manager = await h.signedInOperator('private-view-operator@synthetic.invalid');
  company = await h.onboard(manager, 'Synthetic Private View');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'private-view-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'private-view-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  userId = await h.auth.provisionUser({
    email: 'private-view-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  employeeId = randomUUID();
  await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${company},${employeeId},${business},${branch},${userId},'Synthetic staff',${employeeNameMatchKey('Synthetic staff')},'staff','2026-01-01',${takeTestEmployeeNumber(company)})`;
  await h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${company},${randomUUID()},${business},${employeeId},${branch},'2026-01-01')`;
  expect(
    (
      await h.send('POST', '/v1/staff-pins/reset', {
        cookie: manager,
        company,
        body: { user_id: userId, pin: ownPin },
      })
    ).status,
  ).toBe(204);
  const signedIn = await h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone, pin: ownPin },
  });
  expect(signedIn.statusCode).toBe(200);
  staffCookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
});
afterAll(async () => {
  await h?.close();
});

it('MY-09 no session at all is refused before any window is read', async () => {
  const response = await ownRoute({ origin });
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
  envelopeOnly(response.json());
});

it('MY-09 a device token alone proves no operator', async () => {
  const response = await ownRoute({ authorization: `Device ${device.token}`, origin });
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
});

it('MY-09 an administration cookie is not an operator session', async () => {
  const response = await ownRoute({ cookie: manager, origin });
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
});

it('MY-09 a session of another business is refused', async () => {
  const other = await h.auth.provisionUser({
    email: 'private-view-other@synthetic.invalid',
    name: 'Synthetic other',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${otherPhone} WHERE id=${other}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${other}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${other},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  const second = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'private-view-second-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic second' },
    })
  ).body['id'] as string;
  const secondBranch = (
    await h.send('POST', `/v1/businesses/${second}/branches`, {
      cookie: manager,
      company,
      key: 'private-view-second-branch',
      body: { name_en: 'Synthetic second' },
    })
  ).body['id'] as string;
  const secondDevice = await paired(h, manager, company, secondBranch);
  const issued = await h.auth.staff.issue(
    other,
    {
      companyId: company,
      businessId: second,
      branchId: secondBranch,
      deviceId: secondDevice.id,
    },
    async () => true,
  );
  const otherCookie = issued.cookie.split(';')[0] ?? '';
  const response = await privateRoute(null, otherCookie);
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
});

it('MY-09 a live session without the window header is refused as expired', async () => {
  const response = await privateRoute(null);
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('PRIVATE_VIEW_EXPIRED');
  expect(response.json()).not.toHaveProperty('ok');
  envelopeOnly(response.json());
});

it('MY-09 a wrong window header is refused as expired and never as a bad request', async () => {
  const response = await privateRoute('not-a-window-id');
  expect(response.statusCode).toBe(403);
  expect(response.json().code).toBe('PRIVATE_VIEW_EXPIRED');
  expect(response.json()).not.toHaveProperty('ok');
});

it('MY-09 a personal session needs no window', async () => {
  const personal = await h.auth.personal.issue(
    userId,
    { purpose: 'STAFF_PERSONAL', companyId: company, businessId: business },
    async () => true,
  );
  const response = await ownRoute({
    origin: personalOrigin,
    cookie: personal.cookie.split(';')[0] ?? '',
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
});

it('a personal session reaches none of the private-view routes', async () => {
  const personal = await h.auth.personal.issue(
    userId,
    { purpose: 'STAFF_PERSONAL', companyId: company, businessId: business },
    async () => true,
  );
  const cookie = personal.cookie.split(';')[0] ?? '';
  const before = await countOpenings();
  for (const suffix of ['', '/touch', '/close']) {
    const response = await h.app.inject({
      method: 'POST',
      url: `/v1/staff/me/private-view${suffix}`,
      headers: {
        origin: personalOrigin,
        cookie,
        ...(suffix === '' ? {} : { [PRIVATE_VIEW_WINDOW_HEADER]: 'synthetic-window' }),
      },
      ...(suffix === '' ? { payload: { pin: ownPin } } : {}),
    });
    expect([401, 403]).toContain(response.statusCode);
    expect(response.json()).not.toHaveProperty('window_id');
    expect(response.json()).not.toHaveProperty('idle_remaining_ms');
  }
  expect(await countOpenings()).toBe(before);
});

it('the private-view handlers carry no personal marker', () => {
  for (const handler of [
    PrivateViewController.prototype.open,
    PrivateViewController.prototype.touch,
    PrivateViewController.prototype.close,
  ]) {
    expect(Reflect.getMetadata(PERSONAL_ROUTE, handler)).toBeUndefined();
  }
});

it('MY-12 another employee PIN opens nothing', async () => {
  const response = await openWindow('9999');
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('PIN_INVALID');
  expect(response.json()).not.toHaveProperty('window_id');
  envelopeOnly(response.json());
});

it('MY-12 the open body names no employee, branch or business', async () => {
  const response = await h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view',
    headers: staffHeaders({ cookie: staffCookie }),
    payload: { pin: ownPin, user_id: userId, employee_id: employeeId, branch_id: branch },
  });
  expect(response.statusCode).toBe(400);
  expect(response.json().code).toBe('VALIDATION_FAILED');
  // الرد بيردّ مسارات الحقول المرفوضة بس، مش القيم المرفوضة نفسها.
  expect(Object.keys(response.json()).sort()).toEqual([
    'code',
    'details',
    'message_ar',
    'message_en',
  ]);
  expect(JSON.stringify(response.json().details)).not.toContain(userId);
  expect(JSON.stringify(response.json().details)).not.toContain(branch);
});

it('MY-10 a membership lost after the sign-in refuses the request even with a live window', async () => {
  const opened = await openWindow(ownPin);
  expect(opened.statusCode).toBe(200);
  const windowId = opened.json().window_id as string;
  await h.owner`DELETE FROM memberships WHERE company_id=${company} AND user_id=${userId}`;
  const response = await privateRoute(windowId);
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
});

it('a successful open writes one audit row and a refusal writes none', async () => {
  const before = await countOpenings();
  const opened = await openWindow(ownPin);
  expect(opened.statusCode).toBe(200);
  const refused = await openWindow('9999');
  expect(refused.statusCode).toBe(401);
  expect(await countOpenings()).toBe(before + 1);
});

it('the window header never reaches a log line', async () => {
  const opened = await openWindow(ownPin);
  const windowId = opened.json().window_id as string;
  await privateRoute(windowId);
  createLogger('info', { destination: sink, events: API_LOG_EVENTS }).info(
    { headers: { [PRIVATE_VIEW_WINDOW_HEADER]: windowId } },
    'request completed',
  );
  const captured = lines.join('');
  expect(captured).toContain(`"${PRIVATE_VIEW_WINDOW_HEADER}":"[REDACTED]"`);
  expect(captured).not.toContain(windowId);
});
