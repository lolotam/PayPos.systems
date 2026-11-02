import { randomUUID } from 'node:crypto';
import { Controller, Get, SetMetadata } from '@nestjs/common';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PRIVATE_VIEW_WINDOW_HEADER } from '@pospay/contracts';
import { present } from '../../../../../../packages/db/test/present.ts';
import { origin, paired, phone } from '../../../../test/staff-otp-harness.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { Authenticated } from '../../../shared/access.decorators.ts';
import { PERSONAL_ROUTE } from '../../../shared/personal-authentication.ts';
import { PrivateViewRoute } from '../../../shared/private-view.guard.ts';
import { STAFF_ROUTE } from '../../../shared/staff-authentication.ts';

const ownPin = '1234';
const otherPin = '5678';
const otherPhone = '+99900000002';

// مسار اختباري مثبّت مع التطبيق: المسار المحمي بيتحقق من النافذة بعد جلسة الموظف.
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
  staffCookie: string;
// الساعة الحقيقية + إزاحة: مهلة قاعدة البيانات المحدودة بتتحسب بالساعة الحقيقية، فساعة واقفة بتخلّي المهلة فاتت.
const clock = { offsetMs: 0 };
const advance = (ms: number): void => {
  clock.offsetMs += ms;
};

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
const touch = (windowId: string, cookie = staffCookie) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view/touch',
    headers: staffHeaders({ cookie, [PRIVATE_VIEW_WINDOW_HEADER]: windowId }),
  });
const close = (windowId: string, cookie = staffCookie) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/staff/me/private-view/close',
    headers: staffHeaders({ cookie, [PRIVATE_VIEW_WINDOW_HEADER]: windowId }),
  });
const privateRoute = (windowId: string | null, cookie = staffCookie) =>
  h.app.inject({
    method: 'GET',
    url: '/v1/test/private-own',
    headers: staffHeaders({
      cookie,
      ...(windowId === null ? {} : { [PRIVATE_VIEW_WINDOW_HEADER]: windowId }),
    }),
  });
const signIn = (number: string, pin: string) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/devices/me/staff-pin/sign-in',
    headers: { authorization: `Device ${device.token}`, origin },
    payload: { phone: number, pin },
  });

beforeAll(async () => {
  h = await startHarness({
    staffOrigin: origin,
    clock: { now: () => new Date(Date.now() + clock.offsetMs) },
    controllers: [TestPrivateOwnController],
  });
  manager = await h.signedInOperator('private-window-operator@synthetic.invalid');
  company = await h.onboard(manager, 'Synthetic Private Window');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: manager,
      company,
      key: 'private-window-business',
      body: { vertical_type: 'salon', name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  branch = (
    await h.send('POST', `/v1/businesses/${business}/branches`, {
      cookie: manager,
      company,
      key: 'private-window-branch',
      body: { name_en: 'Synthetic' },
    })
  ).body['id'] as string;
  device = await paired(h, manager, company, branch);
  userId = await h.auth.provisionUser({
    email: 'private-window-user@synthetic.invalid',
    name: 'Synthetic',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${phone} WHERE id=${userId}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${userId},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  const reset = async (target: string, pin: string) =>
    h.send('POST', '/v1/staff-pins/reset', {
      cookie: manager,
      company,
      body: { user_id: target, pin },
    });
  expect((await reset(userId, ownPin)).status).toBe(204);
  const signedIn = await signIn(phone, ownPin);
  expect(signedIn.statusCode).toBe(200);
  staffCookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
});
afterAll(async () => {
  await h?.close();
});

it('MY-13b a PIN opens the window and the private route answers with the remaining times', async () => {
  const opened = await openWindow(ownPin);
  expect(opened.statusCode).toBe(200);
  expect(opened.json()).toMatchObject({
    window_id: expect.any(String),
    window_seq: expect.any(String),
    session_ref: expect.any(String),
    idle_remaining_ms: 60_000,
    cap_remaining_ms: 300_000,
  });
  const response = await privateRoute(opened.json().window_id);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  expect(response.headers['x-private-view-idle-remaining-ms']).toBe('60000');
  // الساعة حقيقية، فالسقف بيقل بالوقت اللي عدّى بين الفتح والطلب، وده ممكن يوصل ثواني على runner مشغول.
  const cap = Number(response.headers['x-private-view-cap-remaining-ms']);
  expect(cap).toBeLessThanOrEqual(300_000);
  expect(cap).toBeGreaterThan(295_000);
});

it('MY-13b the window dies after sixty seconds without a touch', async () => {
  const opened = await openWindow(ownPin);
  const windowId = opened.json().window_id as string;
  advance(61_000);
  const expired = await touch(windowId);
  expect(expired.statusCode).toBe(403);
  expect(expired.json().code).toBe('PRIVATE_VIEW_EXPIRED');
  expect(expired.json()).not.toHaveProperty('ok');
  expect((await touch(windowId)).statusCode).toBe(403);
});

it('MY-13b a touch every fifty seconds keeps the window until the five minute cap', async () => {
  const opened = await openWindow(ownPin);
  const windowId = opened.json().window_id as string;
  for (let elapsed = 50_000; elapsed <= 250_000; elapsed += 50_000) {
    advance(50_000);
    const kept = await touch(windowId);
    expect(kept.statusCode).toBe(200);
  }
  // الساعة حقيقية + إزاحة، فنسيب خمس ثواني هامش للوقت الحقيقي اللي بيعدّي أثناء الاختبار قبل السقف.
  advance(45_000);
  expect((await touch(windowId)).statusCode).toBe(200);
  advance(6_000);
  const capped = await touch(windowId);
  expect(capped.statusCode).toBe(403);
  expect(capped.json().code).toBe('PRIVATE_VIEW_EXPIRED');
});

it('MY-13b a late request with the old window id is refused and the new window still passes', async () => {
  const first = await openWindow(ownPin);
  const oldWindow = first.json().window_id as string;
  const second = await openWindow(ownPin);
  const newWindow = second.json().window_id as string;
  expect(newWindow).not.toBe(oldWindow);
  const late = await privateRoute(oldWindow);
  expect(late.statusCode).toBe(403);
  expect(late.json().code).toBe('PRIVATE_VIEW_EXPIRED');
  expect((await privateRoute(newWindow)).statusCode).toBe(200);
});

it('MY-13b closing the window ends it and closing a wrong id changes nothing', async () => {
  const opened = await openWindow(ownPin);
  const windowId = opened.json().window_id as string;
  expect((await close(windowId)).statusCode).toBe(204);
  const afterClose = await touch(windowId);
  expect(afterClose.statusCode).toBe(403);
  expect(afterClose.json().code).toBe('PRIVATE_VIEW_EXPIRED');
  const reopened = await openWindow(ownPin);
  const live = reopened.json().window_id as string;
  expect((await close('not-the-live-window')).statusCode).toBe(204);
  expect((await touch(live)).statusCode).toBe(200);
});

it('MY-13b a second operator replaces the first session', async () => {
  const other = await h.auth.provisionUser({
    email: 'private-window-other@synthetic.invalid',
    name: 'Synthetic other',
    password: 'synthetic'.repeat(8),
  });
  await h.owner`UPDATE "user" SET phone_number=${otherPhone} WHERE id=${other}`;
  await h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${other}`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
      SELECT ${company},${randomUUID()},${other},id,'global','BRANCH',${branch} FROM roles WHERE code='staff' AND company_id IS NULL`;
  expect(
    (
      await h.send('POST', '/v1/staff-pins/reset', {
        cookie: manager,
        company,
        body: { user_id: other, pin: otherPin },
      })
    ).status,
  ).toBe(204);
  const replaced = await signIn(otherPhone, otherPin);
  expect(replaced.statusCode).toBe(200);
  const response = await privateRoute('synthetic-window-id');
  expect(response.statusCode).toBe(401);
  expect(response.json().code).toBe('UNAUTHENTICATED');
  expect(response.json()).not.toHaveProperty('ok');
});

it('the wrong step-up PINs count on the sign-in counter', async () => {
  const signedIn = await signIn(otherPhone, otherPin);
  expect(signedIn.statusCode).toBe(200);
  const cookie = present(String(signedIn.headers['set-cookie']).split(';')[0]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const refused = await openWindow('0000', cookie);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe('PIN_INVALID');
  }
  const locked = await signIn(otherPhone, otherPin);
  expect(locked.statusCode).toBe(401);
  expect(locked.json().code).toBe('PIN_INVALID');
});
